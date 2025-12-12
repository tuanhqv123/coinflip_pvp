/// Comprehensive Tests - Winner Claims Reward
/// 
/// USER STORIES:
/// 1. Happy path: Create → Join → Full → Backend sets winner → Winner claims
/// 2. Non-winner cannot claim
/// 3. Cannot claim before unlock
/// 4. Cannot claim twice
/// 5. Cancel room with refunds
/// 6. Various validations
#[test_only]
module coinflip_battle_move::game_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use coinflip_battle_move::game::{Self, FlipGame, GameEscrow};

    const CREATOR: address = @0xA;
    const PLAYER2: address = @0xB;
    const PLAYER3: address = @0xC;
    const PLAYER4: address = @0xD;
    const OUTSIDER: address = @0xF;

    const STAKE: u64 = 1_000_000_000;
    const BASE_TIME: u64 = 1000000;

    fun mint(scenario: &mut Scenario, amount: u64): Coin<SUI> {
        coin::mint_for_testing<SUI>(amount, ts::ctx(scenario))
    }

    fun new_clock(scenario: &mut Scenario, time: u64): Clock {
        let mut clock = clock::create_for_testing(ts::ctx(scenario));
        clock::set_for_testing(&mut clock, time);
        clock
    }

    // ============================================================
    // TEST 1: Happy Path - Winner Claims Reward
    // ============================================================
    #[test]
    fun test_happy_path_winner_claims() {
        let mut scenario = ts::begin(CREATOR);
        let mut clock = new_clock(&mut scenario, BASE_TIME);

        // 1. Create room
        let payment = mint(&mut scenario, STAKE);
        game::create_room(2, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PLAYER2);

        // 2. Player2 joins → game full
        let mut game = ts::take_shared<FlipGame>(&scenario);
        let mut escrow = ts::take_shared<GameEscrow>(&scenario);
        let payment2 = mint(&mut scenario, STAKE);
        game::join_room(&mut game, &mut escrow, payment2, &clock, ts::ctx(&mut scenario));
        
        assert!(game::is_started(&game), 0);
        assert!(game::get_total_stake(&game) == STAKE * 2, 1);
        
        ts::return_shared(game);
        ts::return_shared(escrow);
        ts::next_tx(&mut scenario, CREATOR);

        // 3. Backend sets winner (PLAYER2 wins)
        let mut game = ts::take_shared<FlipGame>(&scenario);
        game::set_winner(&mut game, PLAYER2, b"encrypted_winner_blob");
        
        assert!(option::is_some(game::get_winner(&game)), 2);
        assert!(*option::borrow(game::get_winner(&game)) == PLAYER2, 3);
        
        ts::return_shared(game);
        ts::next_tx(&mut scenario, PLAYER2);

        // 4. Fast forward past unlock
        let unlock_time = BASE_TIME + game::get_lock_duration();
        clock::set_for_testing(&mut clock, unlock_time + 1000);

        // 5. Winner (PLAYER2) claims reward
        let game = ts::take_shared<FlipGame>(&scenario);
        let escrow = ts::take_shared<GameEscrow>(&scenario);
        
        assert!(game::can_claim(&game, &clock), 4);
        game::claim_reward(game, escrow, &clock, ts::ctx(&mut scenario));

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 2: Non-Winner Cannot Claim
    // ============================================================
    #[test]
    #[expected_failure(abort_code = game::E_NOT_WINNER)]
    fun test_non_winner_cannot_claim() {
        let mut scenario = ts::begin(CREATOR);
        let mut clock = new_clock(&mut scenario, BASE_TIME);

        let payment = mint(&mut scenario, STAKE);
        game::create_room(2, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PLAYER2);

        let mut game = ts::take_shared<FlipGame>(&scenario);
        let mut escrow = ts::take_shared<GameEscrow>(&scenario);
        let payment2 = mint(&mut scenario, STAKE);
        game::join_room(&mut game, &mut escrow, payment2, &clock, ts::ctx(&mut scenario));
        ts::return_shared(game);
        ts::return_shared(escrow);
        ts::next_tx(&mut scenario, CREATOR);

        // Backend sets PLAYER2 as winner
        let mut game = ts::take_shared<FlipGame>(&scenario);
        game::set_winner(&mut game, PLAYER2, b"blob");
        ts::return_shared(game);
        ts::next_tx(&mut scenario, CREATOR); // CREATOR tries to claim (not winner)

        clock::set_for_testing(&mut clock, BASE_TIME + 10000);

        let game = ts::take_shared<FlipGame>(&scenario);
        let escrow = ts::take_shared<GameEscrow>(&scenario);
        
        // CREATOR tries to claim but PLAYER2 is winner - FAIL
        game::claim_reward(game, escrow, &clock, ts::ctx(&mut scenario));

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 3: Cannot Claim Before Unlock
    // ============================================================
    #[test]
    #[expected_failure(abort_code = game::E_TOO_EARLY)]
    fun test_cannot_claim_before_unlock() {
        let mut scenario = ts::begin(CREATOR);
        let clock = new_clock(&mut scenario, BASE_TIME);

        let payment = mint(&mut scenario, STAKE);
        game::create_room(2, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PLAYER2);

        let mut game = ts::take_shared<FlipGame>(&scenario);
        let mut escrow = ts::take_shared<GameEscrow>(&scenario);
        let payment2 = mint(&mut scenario, STAKE);
        game::join_room(&mut game, &mut escrow, payment2, &clock, ts::ctx(&mut scenario));
        ts::return_shared(game);
        ts::return_shared(escrow);
        ts::next_tx(&mut scenario, CREATOR);

        let mut game = ts::take_shared<FlipGame>(&scenario);
        game::set_winner(&mut game, PLAYER2, b"blob");
        ts::return_shared(game);
        ts::next_tx(&mut scenario, PLAYER2);

        // Try claim BEFORE unlock - FAIL
        let game = ts::take_shared<FlipGame>(&scenario);
        let escrow = ts::take_shared<GameEscrow>(&scenario);
        game::claim_reward(game, escrow, &clock, ts::ctx(&mut scenario));

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 4: Winner Not Set Cannot Claim
    // ============================================================
    #[test]
    #[expected_failure(abort_code = game::E_WINNER_NOT_SET)]
    fun test_winner_not_set_cannot_claim() {
        let mut scenario = ts::begin(CREATOR);
        let mut clock = new_clock(&mut scenario, BASE_TIME);

        let payment = mint(&mut scenario, STAKE);
        game::create_room(2, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PLAYER2);

        let mut game = ts::take_shared<FlipGame>(&scenario);
        let mut escrow = ts::take_shared<GameEscrow>(&scenario);
        let payment2 = mint(&mut scenario, STAKE);
        game::join_room(&mut game, &mut escrow, payment2, &clock, ts::ctx(&mut scenario));
        ts::return_shared(game);
        ts::return_shared(escrow);
        ts::next_tx(&mut scenario, PLAYER2);

        // Backend hasn't set winner yet
        clock::set_for_testing(&mut clock, BASE_TIME + 10000);

        let game = ts::take_shared<FlipGame>(&scenario);
        let escrow = ts::take_shared<GameEscrow>(&scenario);
        game::claim_reward(game, escrow, &clock, ts::ctx(&mut scenario));

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 5: Cancel Room Success
    // ============================================================
    #[test]
    fun test_cancel_room_success() {
        let mut scenario = ts::begin(CREATOR);
        let clock = new_clock(&mut scenario, BASE_TIME);

        let payment = mint(&mut scenario, STAKE);
        game::create_room(3, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PLAYER2);

        // Player2 joins
        let mut game = ts::take_shared<FlipGame>(&scenario);
        let mut escrow = ts::take_shared<GameEscrow>(&scenario);
        let payment2 = mint(&mut scenario, STAKE);
        game::join_room(&mut game, &mut escrow, payment2, &clock, ts::ctx(&mut scenario));
        ts::return_shared(game);
        ts::return_shared(escrow);
        ts::next_tx(&mut scenario, CREATOR);

        // Creator cancels (game not full yet)
        let game = ts::take_shared<FlipGame>(&scenario);
        let escrow = ts::take_shared<GameEscrow>(&scenario);
        game::cancel_room(game, escrow, ts::ctx(&mut scenario));

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 6: Non-Creator Cannot Cancel
    // ============================================================
    #[test]
    #[expected_failure(abort_code = game::E_NOT_CREATOR)]
    fun test_non_creator_cannot_cancel() {
        let mut scenario = ts::begin(CREATOR);
        let clock = new_clock(&mut scenario, BASE_TIME);

        let payment = mint(&mut scenario, STAKE);
        game::create_room(2, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PLAYER2);

        let game = ts::take_shared<FlipGame>(&scenario);
        let escrow = ts::take_shared<GameEscrow>(&scenario);
        game::cancel_room(game, escrow, ts::ctx(&mut scenario));

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 7: Cannot Cancel After Game Starts
    // ============================================================
    #[test]
    #[expected_failure(abort_code = game::E_GAME_STARTED)]
    fun test_cannot_cancel_after_start() {
        let mut scenario = ts::begin(CREATOR);
        let clock = new_clock(&mut scenario, BASE_TIME);

        let payment = mint(&mut scenario, STAKE);
        game::create_room(2, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PLAYER2);

        let mut game = ts::take_shared<FlipGame>(&scenario);
        let mut escrow = ts::take_shared<GameEscrow>(&scenario);
        let payment2 = mint(&mut scenario, STAKE);
        game::join_room(&mut game, &mut escrow, payment2, &clock, ts::ctx(&mut scenario));
        ts::return_shared(game);
        ts::return_shared(escrow);
        ts::next_tx(&mut scenario, CREATOR);

        let game = ts::take_shared<FlipGame>(&scenario);
        let escrow = ts::take_shared<GameEscrow>(&scenario);
        game::cancel_room(game, escrow, ts::ctx(&mut scenario));

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 8: Wrong Stake Amount
    // ============================================================
    #[test]
    #[expected_failure(abort_code = game::E_WRONG_AMOUNT)]
    fun test_wrong_stake_amount() {
        let mut scenario = ts::begin(CREATOR);
        let clock = new_clock(&mut scenario, BASE_TIME);

        let payment = mint(&mut scenario, STAKE);
        game::create_room(2, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PLAYER2);

        let mut game = ts::take_shared<FlipGame>(&scenario);
        let mut escrow = ts::take_shared<GameEscrow>(&scenario);
        let wrong_payment = mint(&mut scenario, STAKE / 2);
        game::join_room(&mut game, &mut escrow, wrong_payment, &clock, ts::ctx(&mut scenario));

        ts::return_shared(game);
        ts::return_shared(escrow);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 9: Double Join Prevention
    // ============================================================
    #[test]
    #[expected_failure(abort_code = game::E_ALREADY_JOINED)]
    fun test_double_join() {
        let mut scenario = ts::begin(CREATOR);
        let clock = new_clock(&mut scenario, BASE_TIME);

        let payment = mint(&mut scenario, STAKE);
        game::create_room(3, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, CREATOR);

        let mut game = ts::take_shared<FlipGame>(&scenario);
        let mut escrow = ts::take_shared<GameEscrow>(&scenario);
        let payment2 = mint(&mut scenario, STAKE);
        game::join_room(&mut game, &mut escrow, payment2, &clock, ts::ctx(&mut scenario));

        ts::return_shared(game);
        ts::return_shared(escrow);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 10: Invalid Max Players
    // ============================================================
    #[test]
    #[expected_failure(abort_code = game::E_INVALID_MAX_PLAYERS)]
    fun test_invalid_max_players_low() {
        let mut scenario = ts::begin(CREATOR);
        let clock = new_clock(&mut scenario, BASE_TIME);
        let payment = mint(&mut scenario, STAKE);
        game::create_room(1, payment, &clock, ts::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = game::E_INVALID_MAX_PLAYERS)]
    fun test_invalid_max_players_high() {
        let mut scenario = ts::begin(CREATOR);
        let clock = new_clock(&mut scenario, BASE_TIME);
        let payment = mint(&mut scenario, STAKE);
        game::create_room(11, payment, &clock, ts::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 11: Min Stake Validation
    // ============================================================
    #[test]
    #[expected_failure(abort_code = game::E_MIN_STAKE)]
    fun test_min_stake() {
        let mut scenario = ts::begin(CREATOR);
        let clock = new_clock(&mut scenario, BASE_TIME);
        let small_payment = mint(&mut scenario, 100);
        game::create_room(2, small_payment, &clock, ts::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 12: Set Winner Must Be Player
    // ============================================================
    #[test]
    #[expected_failure(abort_code = game::E_NOT_WINNER)]
    fun test_set_winner_must_be_player() {
        let mut scenario = ts::begin(CREATOR);
        let clock = new_clock(&mut scenario, BASE_TIME);

        let payment = mint(&mut scenario, STAKE);
        game::create_room(2, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PLAYER2);

        let mut game = ts::take_shared<FlipGame>(&scenario);
        let mut escrow = ts::take_shared<GameEscrow>(&scenario);
        let payment2 = mint(&mut scenario, STAKE);
        game::join_room(&mut game, &mut escrow, payment2, &clock, ts::ctx(&mut scenario));
        ts::return_shared(escrow);

        // Try to set OUTSIDER as winner - FAIL
        game::set_winner(&mut game, OUTSIDER, b"blob");

        ts::return_shared(game);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 13: 5-Player Full Flow
    // ============================================================
    #[test]
    fun test_five_player_full_flow() {
        let mut scenario = ts::begin(CREATOR);
        let mut clock = new_clock(&mut scenario, BASE_TIME);

        // Create 5-player room
        let payment = mint(&mut scenario, STAKE);
        game::create_room(5, payment, &clock, ts::ctx(&mut scenario));

        // 4 more players join
        let players = vector[PLAYER2, PLAYER3, PLAYER4, @0x10];
        let mut i = 0;
        while (i < 4) {
            let player = *vector::borrow(&players, i);
            ts::next_tx(&mut scenario, player);
            
            let mut game = ts::take_shared<FlipGame>(&scenario);
            let mut escrow = ts::take_shared<GameEscrow>(&scenario);
            let p = mint(&mut scenario, STAKE);
            game::join_room(&mut game, &mut escrow, p, &clock, ts::ctx(&mut scenario));
            ts::return_shared(game);
            ts::return_shared(escrow);
            i = i + 1;
        };

        ts::next_tx(&mut scenario, CREATOR);

        // Verify game state
        let game = ts::take_shared<FlipGame>(&scenario);
        assert!(game::is_started(&game), 0);
        assert!(game::get_current_players(&game) == 5, 1);
        assert!(game::get_total_stake(&game) == STAKE * 5, 2);
        ts::return_shared(game);

        // Backend sets winner (PLAYER3)
        ts::next_tx(&mut scenario, CREATOR);
        let mut game = ts::take_shared<FlipGame>(&scenario);
        game::set_winner(&mut game, PLAYER3, b"five_player_winner");
        ts::return_shared(game);

        // Fast forward and winner claims
        ts::next_tx(&mut scenario, PLAYER3);
        clock::set_for_testing(&mut clock, BASE_TIME + 10000);
        
        let game = ts::take_shared<FlipGame>(&scenario);
        let escrow = ts::take_shared<GameEscrow>(&scenario);
        game::claim_reward(game, escrow, &clock, ts::ctx(&mut scenario));

        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 14: View Functions
    // ============================================================
    #[test]
    fun test_view_functions() {
        let mut scenario = ts::begin(CREATOR);
        let clock = new_clock(&mut scenario, BASE_TIME);

        let payment = mint(&mut scenario, STAKE);
        game::create_room(3, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PLAYER2);

        let game = ts::take_shared<FlipGame>(&scenario);
        let escrow = ts::take_shared<GameEscrow>(&scenario);

        // Test all view functions
        assert!(game::get_max_players(&game) == 3, 0);
        assert!(game::get_stake_per_player(&game) == STAKE, 1);
        assert!(game::get_creator(&game) == CREATOR, 2);
        assert!(game::get_current_players(&game) == 1, 3);
        assert!(!game::is_full(&game), 4);
        assert!(!game::is_started(&game), 5);
        assert!(!game::is_claimed(&game), 6);
        assert!(game::get_unlock_ms(&game) == 0, 7);
        assert!(option::is_none(game::get_winner(&game)), 8);
        assert!(option::is_none(game::get_blob_id(&game)), 9);
        assert!(!game::can_claim(&game, &clock), 10);
        assert!(game::get_escrow_balance(&escrow) == STAKE, 11);

        ts::return_shared(game);
        ts::return_shared(escrow);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    // ============================================================
    // TEST 15: Seal Approve Timelock
    // ============================================================
    #[test]
    #[expected_failure(abort_code = game::E_TOO_EARLY)]
    fun test_seal_approve_too_early() {
        let mut scenario = ts::begin(CREATOR);
        let clock = new_clock(&mut scenario, BASE_TIME);

        let payment = mint(&mut scenario, STAKE);
        game::create_room(2, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PLAYER2);

        let mut game = ts::take_shared<FlipGame>(&scenario);
        let mut escrow = ts::take_shared<GameEscrow>(&scenario);
        let payment2 = mint(&mut scenario, STAKE);
        game::join_room(&mut game, &mut escrow, payment2, &clock, ts::ctx(&mut scenario));
        ts::return_shared(escrow);

        // Build seal identity
        let unlock_ms = game::get_unlock_ms(&game);
        let mut id = vector::empty<u8>();
        let mut i = 0;
        while (i < 32) { vector::push_back(&mut id, 0); i = i + 1; };
        let unlock_bytes = sui::bcs::to_bytes(&unlock_ms);
        let mut j = 0;
        while (j < vector::length(&unlock_bytes)) {
            vector::push_back(&mut id, *vector::borrow(&unlock_bytes, j));
            j = j + 1;
        };

        // Try seal_approve before unlock - FAIL
        game::seal_approve(id, &game, &clock);

        ts::return_shared(game);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }

    #[test]
    #[allow(unused_mut_ref)]
    fun test_seal_approve_after_unlock() {
        let mut scenario = ts::begin(CREATOR);
        let mut clock = new_clock(&mut scenario, BASE_TIME);

        let payment = mint(&mut scenario, STAKE);
        game::create_room(2, payment, &clock, ts::ctx(&mut scenario));
        ts::next_tx(&mut scenario, PLAYER2);

        let mut game = ts::take_shared<FlipGame>(&scenario);
        let mut escrow = ts::take_shared<GameEscrow>(&scenario);
        let payment2 = mint(&mut scenario, STAKE);
        game::join_room(&mut game, &mut escrow, payment2, &clock, ts::ctx(&mut scenario));
        ts::return_shared(escrow);

        let unlock_ms = game::get_unlock_ms(&game);
        let mut id = vector::empty<u8>();
        let mut i = 0;
        while (i < 32) { vector::push_back(&mut id, 0); i = i + 1; };
        let unlock_bytes = sui::bcs::to_bytes(&unlock_ms);
        let mut j = 0;
        while (j < vector::length(&unlock_bytes)) {
            vector::push_back(&mut id, *vector::borrow(&unlock_bytes, j));
            j = j + 1;
        };

        // Create new clock at unlock time
        clock::set_for_testing(&mut clock, unlock_ms + 1000);

        // seal_approve should succeed
        game::seal_approve(id, &game, &clock);

        ts::return_shared(game);
        clock::destroy_for_testing(clock);
        ts::end(scenario);
    }
}
