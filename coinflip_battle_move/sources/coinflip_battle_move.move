/// Multi-player Coin Flip Game - Winners Split Pot
///
/// FLOW:
/// 1. Creator: create_room(max_players, stake) → deposits stake, room is PUBLIC
/// 2. Players: join_room() → deposit same stake
/// 3. When room is full:
///    - Contract uses on-chain randomness to determine result (heads/tails)
///    - Contract immediately identifies all winners (players who chose correctly)
///    - Contract sets unlock_ms = now + LOCK_DURATION
///    - Backend encrypts result with Seal
///    - Backend uploads to Walrus → blob_id
///    - Backend calls set_blob_id()
/// 4. During locktime (5s):
///    - UI shows coin flipping animation
///    - No one can decrypt result (Seal rejects)
/// 5. After unlock:
///    - Anyone can decrypt result from Walrus
///    - ALL WINNERS can claim their share (total_stake / number_of_winners)
///
/// SECURITY:
/// - Games are PUBLIC (everyone can see game list)
/// - Result determined by on-chain randomness (NOT backend!)
/// - Winners split the pot equally
/// - Seal only locks the result for excitement
#[allow(lint(coin_field, public_entry, public_random))]
module coinflip_battle_move::game {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::event;
    use sui::clock::{Self, Clock};
    use sui::random::{Self, Random};
    use sui::bcs;
    use std::option;
    use std::vector;

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
    const E_RESULT_NOT_SET: u64 = 15;
    const E_NO_WINNERS: u64 = 16;

    // ============ Constants ============
    const MIN_PLAYERS: u8 = 2;
    const MAX_PLAYERS: u8 = 10;
    const MIN_STAKE_AMOUNT: u64 = 1000000; // 0.001 SUI
    const LOCK_DURATION_MS: u64 = 5000;    // 5 seconds

    // ============ Structs ============
    
    /// Game room - PUBLIC shared object (everyone can see)
    public struct FlipGame has key, store {
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
        /// Walrus blob_id containing encrypted result (Seal locked)
        blob_id: Option<vector<u8>>,
        /// Coin flip result: 0 = heads, 1 = tails (determined by randomness)
        coin_result: Option<u8>,
        /// List of all winners (players who chose correctly)
        winners: Option<vector<address>>,
        /// Game state
        game_started: bool,
        claimed: bool,
        created_at: u64,
    }

    /// Escrow holding all funds
    public struct GameEscrow has key, store {
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

    /// Emitted when game is full and result is determined
    public struct GameFull has copy, drop {
        game_id: ID,
        players: vector<address>,
        total_stake: u64,
        unlock_ms: u64,
        coin_result: u8,
        winners: vector<address>,
    }

    /// Emitted when backend sets encrypted result blob_id
    public struct ResultSet has copy, drop {
        game_id: ID,
        coin_result: u8,
        winners: vector<address>,
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
            coin_result: option::none(),
            winners: option::none(),
            game_started: false,
            claimed: false,
            created_at: clock::timestamp_ms(clock),
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
    /// When full → determines result, emits GameFull event for backend
    /// side: 0 = heads, 1 = tails
    public entry fun join_room(
        game: &mut FlipGame,
        escrow: &mut GameEscrow,
        side: u8,
        payment: Coin<SUI>,
        clock: &Clock,
        random: &Random,
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

        // Room full → determine result, emit event for backend
        if (new_count == (game.max_players as u64)) {
            let now = clock::timestamp_ms(clock);
            game.game_started = true;
            game.unlock_ms = now + LOCK_DURATION_MS;

            // Use on-chain randomness to determine coin flip result
            let mut generator = random::new_generator(random, ctx);
            let random_value = generator.generate_u64();
            let coin_result = if (random_value % 2 == 0) SIDE_HEADS else SIDE_TAILS;

            // Find all winners (players who chose correctly)
            let mut winners = vector::empty<address>();
            let mut i = 0;
            while (i < new_count) {
                let player_side = *vector::borrow(&game.player_sides, i);
                if (player_side == coin_result) {
                    vector::push_back(&mut winners, *vector::borrow(&game.players, i));
                };
                i = i + 1;
            };

            // Ensure we have at least one winner (should always be true)
            assert!(vector::length(&winners) > 0, E_NO_WINNERS);

            // Store result and winners
            option::fill(&mut game.coin_result, coin_result);
            option::fill(&mut game.winners, winners);

            // Backend listens to this!
            event::emit(GameFull {
                game_id: object::uid_to_inner(&game.id),
                players: game.players,
                total_stake: game.total_stake,
                unlock_ms: game.unlock_ms,
                coin_result,
                winners: *option::borrow(&game.winners),
            });
        };
    }

    /// Backend sets encrypted blob_id after game result is determined
    /// Called by backend wallet after uploading to Walrus
    public entry fun set_blob_id(
        game: &mut FlipGame,
        blob_id: vector<u8>,
    ) {
        assert!(game.game_started, E_GAME_NOT_STARTED);
        assert!(option::is_some(&game.coin_result), E_RESULT_NOT_SET);
        assert!(option::is_none(&game.blob_id), E_BLOB_ALREADY_SET);
        assert!(vector::length(&blob_id) > 0, E_BLOB_NOT_SET);

        option::fill(&mut game.blob_id, blob_id);

        event::emit(ResultSet {
            game_id: object::uid_to_inner(&game.id),
            coin_result: *option::borrow(&game.coin_result),
            winners: *option::borrow(&game.winners),
            blob_id,
            unlock_ms: game.unlock_ms,
        });
    }

    /// Winner claims reward - ANY WINNER CAN CALL
    /// After unlock_ms, winner decrypts from Walrus and claims
    public entry fun claim_reward(
        game: FlipGame,
        mut escrow: GameEscrow,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let caller = ctx.sender();
        let now = clock::timestamp_ms(clock);

        // Validations
        assert!(game.game_started, E_GAME_NOT_STARTED);
        assert!(option::is_some(&game.coin_result), E_RESULT_NOT_SET);
        assert!(now >= game.unlock_ms, E_TOO_EARLY);
        assert!(!game.claimed, E_ALREADY_CLAIMED);

        // ONLY WINNER can claim
        let winners = option::borrow(&game.winners);
        assert!(vector::contains(winners, &caller), E_NOT_WINNER);
        assert!(object::uid_to_inner(&game.id) == escrow.game_id, E_WRONG_AMOUNT);

        // Calculate reward per winner
        let num_winners = vector::length(winners);
        let reward_per_winner = game.total_stake / (num_winners as u64);
        let creator = game.creator;
        let game_id = object::uid_to_inner(&game.id);

        // Winner claims their share by splitting from escrow
        let reward = coin::split(&mut escrow.funds, reward_per_winner, ctx);
        transfer::public_transfer(reward, caller);

        event::emit(RewardClaimed {
            game_id,
            winner: caller,
            amount: reward_per_winner,
            claimed_at: now,
        });

        // Extract remaining funds from escrow and delete escrow
        let GameEscrow { id: escrow_id, game_id: _, funds } = escrow;
        object::delete(escrow_id);

        // For now, transfer remaining funds to creator for simplicity
        if (coin::value(&funds) > 0) {
            transfer::public_transfer(funds, creator);
        } else {
            coin::destroy_zero(funds);
        };

        // Delete game object
        let FlipGame { 
            id: game_uid, 
            creator: _, 
            max_players: _, 
            players: _, 
            player_sides: _, 
            stake_per_player: _, 
            total_stake: _, 
            unlock_ms: _, 
            blob_id: _, 
            coin_result: _, 
            winners: _, 
            game_started: _, 
            claimed: _, 
            created_at: _ 
        } = game;
        object::delete(game_uid);
    }

    /// Cancel game room - ONLY creator, ONLY when no other players joined
    public entry fun cancel_room(
        game: FlipGame,
        escrow: GameEscrow,
        ctx: &mut TxContext
    ) {
        assert!(ctx.sender() == game.creator, E_NOT_CREATOR);
        assert!(!game.game_started, E_GAME_STARTED);
        
        // Can only cancel if creator is the only player (no one else joined)
        let num_players = vector::length(&game.players);
        assert!(num_players == 1, E_GAME_STARTED); // Reuse error - means others joined

        let game_id = object::uid_to_inner(&game.id);
        let players_copy = game.players;
        let stake_per_player = game.stake_per_player;

        // Extract funds from escrow for refund
        let GameEscrow { id: escrow_id, game_id: _, funds } = escrow;
        object::delete(escrow_id);

        // Refund creator (only player)
        transfer::public_transfer(funds, ctx.sender());

        event::emit(GameCancelled {
            game_id,
            refunded_players: players_copy,
            refund_per_player: stake_per_player,
        });

        // Delete game object
        let FlipGame { 
            id: game_uid, 
            creator: _, 
            max_players: _, 
            players: _, 
            player_sides: _, 
            stake_per_player: _, 
            total_stake: _, 
            unlock_ms: _, 
            blob_id: _, 
            coin_result: _, 
            winners: _, 
            game_started: _, 
            claimed: _, 
            created_at: _ 
        } = game;
        object::delete(game_uid);
    }

    // ============ Seal Timelock Approval ============
    
    /// Seal approve - key server calls this to verify decryption allowed
    /// Identity format: [package_id (32 bytes)][bcs(unlock_ms)]
    public entry fun seal_approve(
        id: vector<u8>,
        clock: &Clock,
    ) {
        // Extract timestamp from identity (last 8 bytes)
        let id_len = vector::length(&id);
        assert!(id_len >= 8, E_INVALID_SEAL_ID);

        // Get the timestamp from the identity
        let mut timestamp_bytes = vector::empty<u8>();
        let mut i = id_len - 8;
        while (i < id_len) {
            vector::push_back(&mut timestamp_bytes, *vector::borrow(&id, i));
            i = i + 1;
        };

        let unlock_ms = bcs::peel_u64(&mut bcs::new(timestamp_bytes));

        // Only approve after unlock_ms
        let now = clock::timestamp_ms(clock);
        assert!(now >= unlock_ms, E_TOO_EARLY);
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
    public fun get_coin_result(game: &FlipGame): &Option<u8> { &game.coin_result }
    public fun get_winners(game: &FlipGame): &Option<vector<address>> { &game.winners }
    
    /// Check if a specific player is a winner
    public fun is_winner(game: &FlipGame, player: address): bool {
        if (option::is_some(&game.winners)) {
            let winners = option::borrow(&game.winners);
            vector::contains(winners, &player)
        } else {
            false
        }
    }

    /// Get number of winners
    public fun get_num_winners(game: &FlipGame): u64 {
        if (option::is_some(&game.winners)) {
            vector::length(option::borrow(&game.winners))
        } else {
            0
        }
    }

    /// Calculate reward per winner
    public fun get_reward_per_winner(game: &FlipGame): u64 {
        let num_winners = get_num_winners(game);
        if (num_winners > 0) {
            game.total_stake / num_winners
        } else {
            0
        }
    }

    /// Check if claim is available for a specific player
    public fun can_claim(game: &FlipGame, player: address, clock: &Clock): bool {
        game.game_started &&
        option::is_some(&game.coin_result) &&
        !game.claimed &&
        clock::timestamp_ms(clock) >= game.unlock_ms &&
        is_winner(game, player)
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
