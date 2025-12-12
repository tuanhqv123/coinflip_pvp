/// Multi-player Coin Flip Game - Winner Takes All
/// 
/// FLOW:
/// 1. Creator: create_room(max_players, stake) → deposits stake, room is PUBLIC
/// 2. Players: join_room() → deposit same stake
/// 3. When room is full:
///    - Contract sets unlock_ms = now + LOCK_DURATION
///    - Backend picks random winner, encrypts with Seal
///    - Backend uploads to Walrus → blob_id
///    - Backend calls set_blob_id()
/// 4. During locktime (5s):
///    - UI shows coin flipping animation
///    - No one can decrypt winner (Seal rejects)
/// 5. After unlock:
///    - Anyone can decrypt winner from Walrus
///    - ONLY WINNER can call claim_reward() to get all funds
/// 
/// SECURITY:
/// - Games are PUBLIC (everyone can see game list)
/// - Seal only locks winner identity
/// - Only verified winner can claim
/// - Winner takes ALL (100% of pool)
#[allow(lint(coin_field, public_entry))]
module coinflip_battle_move::game {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::event;
    use sui::clock::Clock;

    // ============ Errors ============
    const E_INVALID_MAX_PLAYERS: u64 = 1;
    const E_WRONG_AMOUNT: u64 = 2;
    const E_GAME_FULL: u64 = 3;
    const E_ALREADY_JOINED: u64 = 4;
    const E_GAME_STARTED: u64 = 5;
    const E_GAME_NOT_STARTED: u64 = 6;
    const E_NOT_CREATOR: u64 = 7;
    const E_NOT_WINNER: u64 = 8;
    const E_MIN_STAKE: u64 = 9;
    const E_TOO_EARLY: u64 = 10;
    const E_ALREADY_CLAIMED: u64 = 11;
    const E_BLOB_ALREADY_SET: u64 = 12;
    const E_BLOB_NOT_SET: u64 = 13;
    const E_INVALID_SEAL_ID: u64 = 14;
    const E_WINNER_NOT_SET: u64 = 15;

    // ============ Constants ============
    const MIN_PLAYERS: u8 = 2;
    const MAX_PLAYERS: u8 = 10;
    const MIN_STAKE_AMOUNT: u64 = 1000000; // 0.001 SUI
    const LOCK_DURATION_MS: u64 = 5000;    // 5 seconds

    // ============ Structs ============
    
    /// Game room - PUBLIC shared object (everyone can see)
    public struct FlipGame has key {
        id: UID,
        creator: address,
        max_players: u8,
        players: vector<address>,
        /// Player side choices: 0 = heads, 1 = tails
        player_sides: vector<u8>,
        stake_per_player: u64,
        total_stake: u64,
        /// Timestamp when claim becomes available
        unlock_ms: u64,
        /// Walrus blob_id containing encrypted winner (Seal locked)
        blob_id: Option<vector<u8>>,
        /// Winner address (set by backend after picking)
        winner: Option<address>,
        /// Game state
        game_started: bool,
        claimed: bool,
        created_at: u64,
    }

    /// Escrow holding all funds
    public struct GameEscrow has key {
        id: UID,
        game_id: ID,
        funds: Coin<SUI>,
    }

    // ============ Events ============
    
    public struct GameCreated has copy, drop {
        game_id: ID,
        escrow_id: ID,
        creator: address,
        max_players: u8,
        stake_per_player: u64,
    }

    public struct PlayerJoined has copy, drop {
        game_id: ID,
        player: address,
        current_players: u64,
        max_players: u8,
    }

    /// Backend listens to this event to pick winner
    public struct GameFull has copy, drop {
        game_id: ID,
        players: vector<address>,
        total_stake: u64,
        unlock_ms: u64,
    }

    /// Emitted when backend sets winner + blob_id
    public struct WinnerSet has copy, drop {
        game_id: ID,
        winner: address,
        blob_id: vector<u8>,
        unlock_ms: u64,
    }

    public struct RewardClaimed has copy, drop {
        game_id: ID,
        winner: address,
        amount: u64,
        claimed_at: u64,
    }

    public struct GameCancelled has copy, drop {
        game_id: ID,
        refunded_players: vector<address>,
        refund_per_player: u64,
    }

    // ============ Entry Functions ============

    // Side constants
    const SIDE_HEADS: u8 = 0;
    const SIDE_TAILS: u8 = 1;

    /// Create a new game room (PUBLIC - everyone can see)
    /// side: 0 = heads, 1 = tails
    public entry fun create_room(
        max_players: u8,
        side: u8,
        payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(max_players >= MIN_PLAYERS && max_players <= MAX_PLAYERS, E_INVALID_MAX_PLAYERS);
        assert!(side == SIDE_HEADS || side == SIDE_TAILS, E_WRONG_AMOUNT);
        let stake_per_player = coin::value(&payment);
        assert!(stake_per_player >= MIN_STAKE_AMOUNT, E_MIN_STAKE);

        let creator = ctx.sender();
        let game_uid = object::new(ctx);
        let game_id = object::uid_to_inner(&game_uid);

        let mut players = vector::empty<address>();
        vector::push_back(&mut players, creator);

        let mut player_sides = vector::empty<u8>();
        vector::push_back(&mut player_sides, side);

        let game = FlipGame {
            id: game_uid,
            creator,
            max_players,
            players,
            player_sides,
            stake_per_player,
            total_stake: stake_per_player,
            unlock_ms: 0,
            blob_id: option::none(),
            winner: option::none(),
            game_started: false,
            claimed: false,
            created_at: sui::clock::timestamp_ms(clock),
        };

        let escrow_uid = object::new(ctx);
        let escrow_id = object::uid_to_inner(&escrow_uid);
        let escrow = GameEscrow {
            id: escrow_uid,
            game_id,
            funds: payment,
        };

        event::emit(GameCreated {
            game_id,
            escrow_id,
            creator,
            max_players,
            stake_per_player,
        });

        transfer::share_object(game);
        transfer::share_object(escrow);
    }

    /// Join an existing game room
    /// When full → emits GameFull event for backend
    /// side: 0 = heads, 1 = tails
    public entry fun join_room(
        game: &mut FlipGame,
        escrow: &mut GameEscrow,
        side: u8,
        payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let player = ctx.sender();
        let current_count = vector::length(&game.players);
        
        assert!(!game.game_started, E_GAME_STARTED);
        assert!(current_count < (game.max_players as u64), E_GAME_FULL);
        assert!(!vector::contains(&game.players, &player), E_ALREADY_JOINED);
        assert!(coin::value(&payment) == game.stake_per_player, E_WRONG_AMOUNT);
        assert!(object::uid_to_inner(&game.id) == escrow.game_id, E_WRONG_AMOUNT);
        assert!(side == SIDE_HEADS || side == SIDE_TAILS, E_WRONG_AMOUNT);

        vector::push_back(&mut game.players, player);
        vector::push_back(&mut game.player_sides, side);
        game.total_stake = game.total_stake + game.stake_per_player;
        coin::join(&mut escrow.funds, payment);

        let new_count = vector::length(&game.players);

        event::emit(PlayerJoined {
            game_id: object::uid_to_inner(&game.id),
            player,
            current_players: new_count,
            max_players: game.max_players,
        });

        // Room full → start game, emit event for backend
        if (new_count == (game.max_players as u64)) {
            let now = sui::clock::timestamp_ms(clock);
            game.game_started = true;
            game.unlock_ms = now + LOCK_DURATION_MS;

            // Backend listens to this!
            event::emit(GameFull {
                game_id: object::uid_to_inner(&game.id),
                players: game.players,
                total_stake: game.total_stake,
                unlock_ms: game.unlock_ms,
            });
        };
    }

    /// Backend sets winner and blob_id after picking random winner
    /// Called by backend wallet after:
    /// 1. Picking random winner from players
    /// 2. Encrypting winner with Seal (using unlock_ms)
    /// 3. Uploading to Walrus
    public entry fun set_winner(
        game: &mut FlipGame,
        winner: address,
        blob_id: vector<u8>,
    ) {
        assert!(game.game_started, E_GAME_NOT_STARTED);
        assert!(option::is_none(&game.winner), E_BLOB_ALREADY_SET);
        assert!(vector::contains(&game.players, &winner), E_NOT_WINNER);
        assert!(vector::length(&blob_id) > 0, E_BLOB_NOT_SET);

        option::fill(&mut game.winner, winner);
        option::fill(&mut game.blob_id, blob_id);

        event::emit(WinnerSet {
            game_id: object::uid_to_inner(&game.id),
            winner,
            blob_id,
            unlock_ms: game.unlock_ms,
        });
    }

    /// Winner claims reward - ONLY WINNER CAN CALL
    /// After unlock_ms, winner decrypts from Walrus and claims
    public entry fun claim_reward(
        game: FlipGame,
        escrow: GameEscrow,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let caller = ctx.sender();
        let now = sui::clock::timestamp_ms(clock);
        
        // Validations
        assert!(game.game_started, E_GAME_NOT_STARTED);
        assert!(option::is_some(&game.winner), E_WINNER_NOT_SET);
        assert!(now >= game.unlock_ms, E_TOO_EARLY);
        assert!(!game.claimed, E_ALREADY_CLAIMED);
        
        // ONLY WINNER can claim
        let winner = *option::borrow(&game.winner);
        assert!(caller == winner, E_NOT_WINNER);
        assert!(object::uid_to_inner(&game.id) == escrow.game_id, E_WRONG_AMOUNT);

        let FlipGame {
            id: game_uid,
            creator: _,
            max_players: _,
            players: _,
            player_sides: _,
            stake_per_player: _,
            total_stake,
            unlock_ms: _,
            blob_id: _,
            winner: _,
            game_started: _,
            claimed: _,
            created_at: _,
        } = game;

        let game_id = object::uid_to_inner(&game_uid);
        let GameEscrow { id: escrow_uid, game_id: _, funds } = escrow;

        // Winner takes ALL (100% of pool)
        transfer::public_transfer(funds, winner);

        event::emit(RewardClaimed {
            game_id,
            winner,
            amount: total_stake,
            claimed_at: now,
        });

        // Delete objects
        object::delete(game_uid);
        object::delete(escrow_uid);
    }

    /// Cancel game room - ONLY creator, ONLY before game starts
    public entry fun cancel_room(
        game: FlipGame,
        escrow: GameEscrow,
        ctx: &mut TxContext
    ) {
        assert!(ctx.sender() == game.creator, E_NOT_CREATOR);
        assert!(!game.game_started, E_GAME_STARTED);

        let FlipGame { 
            id: game_uid, 
            creator: _, 
            max_players: _,
            players,
            player_sides: _,
            stake_per_player,
            total_stake: _,
            unlock_ms: _,
            blob_id: _, 
            winner: _,
            game_started: _,
            claimed: _,
            created_at: _,
        } = game;

        let game_id = object::uid_to_inner(&game_uid);
        let num_players = vector::length(&players);
        let GameEscrow { id: escrow_uid, game_id: _, mut funds } = escrow;

        // Refund each player equally
        let mut i = 0;
        while (i < num_players - 1) {
            let player = *vector::borrow(&players, i);
            let refund = coin::split(&mut funds, stake_per_player, ctx);
            transfer::public_transfer(refund, player);
            i = i + 1;
        };
        let last_player = *vector::borrow(&players, num_players - 1);
        transfer::public_transfer(funds, last_player);

        event::emit(GameCancelled {
            game_id,
            refunded_players: players,
            refund_per_player: stake_per_player,
        });

        object::delete(game_uid);
        object::delete(escrow_uid);
    }

    // ============ Seal Timelock Approval ============
    
    /// Seal approve - key server calls this to verify decryption allowed
    /// Identity format: [package_id (32 bytes)][bcs(unlock_ms)]
    public fun seal_approve(
        id: vector<u8>,
        game: &FlipGame,
        clock: &Clock,
    ) {
        let unlock_bytes = sui::bcs::to_bytes(&game.unlock_ms);
        let id_len = vector::length(&id);
        let unlock_len = vector::length(&unlock_bytes);
        
        assert!(id_len >= unlock_len, E_INVALID_SEAL_ID);
        let mut i = 0;
        while (i < unlock_len) {
            let id_byte = *vector::borrow(&id, id_len - unlock_len + i);
            let unlock_byte = *vector::borrow(&unlock_bytes, i);
            assert!(id_byte == unlock_byte, E_INVALID_SEAL_ID);
            i = i + 1;
        };

        // Only approve after unlock_ms
        let now = sui::clock::timestamp_ms(clock);
        assert!(now >= game.unlock_ms, E_TOO_EARLY);
    }

    // ============ View Functions (PUBLIC - everyone can see) ============

    public fun get_game_id(game: &FlipGame): ID { object::uid_to_inner(&game.id) }
    public fun get_players(game: &FlipGame): &vector<address> { &game.players }
    public fun get_player_sides(game: &FlipGame): &vector<u8> { &game.player_sides }
    public fun get_current_players(game: &FlipGame): u64 { vector::length(&game.players) }
    public fun get_max_players(game: &FlipGame): u8 { game.max_players }
    public fun get_stake_per_player(game: &FlipGame): u64 { game.stake_per_player }
    public fun get_total_stake(game: &FlipGame): u64 { game.total_stake }
    public fun get_unlock_ms(game: &FlipGame): u64 { game.unlock_ms }
    public fun get_created_at(game: &FlipGame): u64 { game.created_at }
    public fun is_full(game: &FlipGame): bool { vector::length(&game.players) == (game.max_players as u64) }
    public fun is_started(game: &FlipGame): bool { game.game_started }
    public fun is_claimed(game: &FlipGame): bool { game.claimed }
    public fun get_creator(game: &FlipGame): address { game.creator }
    public fun get_blob_id(game: &FlipGame): &Option<vector<u8>> { &game.blob_id }
    public fun get_winner(game: &FlipGame): &Option<address> { &game.winner }
    
    /// Check if claim is available
    public fun can_claim(game: &FlipGame, clock: &Clock): bool {
        game.game_started && 
        option::is_some(&game.winner) &&
        !game.claimed && 
        sui::clock::timestamp_ms(clock) >= game.unlock_ms
    }

    /// Check time remaining until unlock (0 if already unlocked)
    public fun time_until_unlock(game: &FlipGame, clock: &Clock): u64 {
        let now = sui::clock::timestamp_ms(clock);
        if (now >= game.unlock_ms) { 0 } else { game.unlock_ms - now }
    }

    public fun get_escrow_balance(escrow: &GameEscrow): u64 { coin::value(&escrow.funds) }
    public fun get_escrow_game_id(escrow: &GameEscrow): ID { escrow.game_id }

    // ============ Test Helpers ============
    #[test_only]
    public fun get_lock_duration(): u64 { LOCK_DURATION_MS }
}
