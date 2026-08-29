// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FhevmTest} from "forge-fhevm/FhevmTest.sol";
import {euint64} from "encrypted-types/EncryptedTypes.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {FoggyPotBalanceLedger} from "../src/FoggyPotBalanceLedger.sol";
import {FoggyPotVault} from "../src/FoggyPotVault.sol";
import {FoggyPotReserve} from "../src/FoggyPotReserve.sol";
import {FoggyPotPrizePool} from "../src/FoggyPotPrizePool.sol";
import {FoggyPotDrawKeeper} from "../src/FoggyPotDrawKeeper.sol";

contract FoggyPotTest is FhevmTest {
    uint256 constant DRAW_PERIOD = 5 minutes;
    uint64 constant TOTAL_PRIZE_PER_DRAW = 100 * 10 ** 6;
    uint64 constant RESERVE_FUNDING = 1_000 * 10 ** 6;

    MockUSDC token;
    FoggyPotBalanceLedger ledger;
    FoggyPotVault vault;
    FoggyPotReserve reserve;
    FoggyPotPrizePool prizePool;
    FoggyPotDrawKeeper keeper;

    Account admin;
    Account alice;
    Account bob;
    Account carol;

    function setUp() public override {
        super.setUp();

        admin = makeAccount("admin");
        alice = makeAccount("alice");
        bob = makeAccount("bob");
        carol = makeAccount("carol");

        vm.startPrank(admin.addr);
        token = new MockUSDC();
        ledger = new FoggyPotBalanceLedger(admin.addr);
        vault = new FoggyPotVault(admin.addr, token, ledger);
        reserve = new FoggyPotReserve(admin.addr, token);
        prizePool =
            new FoggyPotPrizePool(admin.addr, ledger, reserve, vault, DRAW_PERIOD, TOTAL_PRIZE_PER_DRAW);

        ledger.setAuthorizedContracts(address(vault), address(prizePool));
        reserve.setPrizePool(address(prizePool));
        vault.setPrizePool(address(prizePool));

        keeper = new FoggyPotDrawKeeper(admin.addr);
        FoggyPotPrizePool[] memory pools = new FoggyPotPrizePool[](1);
        pools[0] = prizePool;
        keeper.setPools(pools);
        prizePool.setKeeper(address(keeper));

        token.adminMint(admin.addr, RESERVE_FUNDING);
        token.approve(address(reserve), RESERVE_FUNDING);
        reserve.fund(RESERVE_FUNDING);
        vm.stopPrank();

        _fundAndApprove(alice.addr, 1_000 * 10 ** 6);
        _fundAndApprove(bob.addr, 1_000 * 10 ** 6);
        _fundAndApprove(carol.addr, 1_000 * 10 ** 6);
    }

    function _fundAndApprove(address user, uint256 amount) internal {
        vm.prank(admin.addr);
        token.adminMint(user, amount);
        vm.prank(user);
        token.approve(address(vault), type(uint256).max);
    }

    function _decryptBalance(Account memory user) internal returns (uint256) {
        bytes32 handle = euint64.unwrap(ledger.confidentialBalanceOf(user.addr));
        if (handle == bytes32(0)) return 0;
        bytes memory sig = signUserDecrypt(user.key, address(ledger));
        return userDecrypt(handle, user.addr, address(ledger), sig);
    }

    // ---------------------------------------------------------------------
    // Deposit
    // ---------------------------------------------------------------------

    function test_depositCreditsEncryptedBalance() public {
        vm.prank(alice.addr);
        vault.deposit(100 * 10 ** 6);

        assertEq(_decryptBalance(alice), 100 * 10 ** 6);
        assertEq(vault.totalDeposits(), 100 * 10 ** 6);
        assertEq(token.balanceOf(address(vault)), 100 * 10 ** 6);
        assertEq(ledger.depositorsCount(), 1);
    }

    function test_multipleDepositsAccumulate() public {
        vm.prank(alice.addr);
        vault.deposit(100 * 10 ** 6);
        vm.prank(alice.addr);
        vault.deposit(50 * 10 ** 6);

        assertEq(_decryptBalance(alice), 150 * 10 ** 6);
        assertEq(ledger.depositorsCount(), 1); // still a single depositor
    }

    // ---------------------------------------------------------------------
    // Draw
    // ---------------------------------------------------------------------

    function test_runDrawRevertsBeforeWindowElapses() public {
        vm.prank(alice.addr);
        vault.deposit(100 * 10 ** 6);

        vm.prank(admin.addr);
        vm.expectRevert(bytes("PrizePool: too early"));
        prizePool.runDraw();
    }

    function test_runDrawSkipsWithNoDepositors() public {
        vm.warp(block.timestamp + DRAW_PERIOD);
        vm.prank(admin.addr);
        prizePool.runDraw();

        assertEq(prizePool.drawCount(), 1);
        assertEq(prizePool.nextDrawTime(), block.timestamp + DRAW_PERIOD);
    }

    function test_runDrawDistributesPrizesAndConservesTokenBacking() public {
        vm.prank(alice.addr);
        vault.deposit(300 * 10 ** 6);
        vm.prank(bob.addr);
        vault.deposit(200 * 10 ** 6);
        vm.prank(carol.addr);
        vault.deposit(100 * 10 ** 6);

        uint256 reserveBefore = reserve.balance();

        vm.warp(block.timestamp + DRAW_PERIOD);
        vm.prank(admin.addr);
        prizePool.runDraw();

        uint256 reserveAfter = reserve.balance();
        assertEq(reserveBefore - reserveAfter, TOTAL_PRIZE_PER_DRAW);

        uint256 aliceBal = _decryptBalance(alice);
        uint256 bobBal = _decryptBalance(bob);
        uint256 carolBal = _decryptBalance(carol);
        uint256 totalCredited = aliceBal + bobBal + carolBal;

        // The vault must always hold at least as much real backing as all credited encrypted
        // balances sum to (full collateralization). It can hold MORE: a Minor-tier pass that
        // finds no winner (see FoggyPotPrizePool's NatSpec) still had its fixed budget pulled
        // from Reserve up front, so that slice sits as uncredited surplus in the Vault rather
        // than being lost or left under-collateralized.
        assertGe(token.balanceOf(address(vault)), totalCredited);
        assertEq(token.balanceOf(address(vault)), 600 * 10 ** 6 + TOTAL_PRIZE_PER_DRAW);

        // Grand tier is mathematically guaranteed to find a winner (see NatSpec), so at least
        // grandPrizeAmount is always distributed; at most the full per-draw budget is.
        uint256 totalWon = totalCredited - 600 * 10 ** 6;
        assertGe(totalWon, prizePool.grandPrizeAmount());
        assertLe(totalWon, TOTAL_PRIZE_PER_DRAW);
    }

    function test_runDrawAdvancesNextDrawTimePastMissedWindows() public {
        vm.prank(alice.addr);
        vault.deposit(100 * 10 ** 6);

        vm.warp(block.timestamp + DRAW_PERIOD * 3 + 1);
        vm.prank(admin.addr);
        prizePool.runDraw();

        assertGt(prizePool.nextDrawTime(), block.timestamp);
        assertEq(prizePool.drawCount(), 1);
    }

