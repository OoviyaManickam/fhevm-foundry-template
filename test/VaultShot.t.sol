// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FhevmTest} from "forge-fhevm/FhevmTest.sol";
import {euint64, externalEuint64} from "encrypted-types/EncryptedTypes.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {VaultShotToken} from "../src/VaultShotToken.sol";
import {VaultShotBalanceLedger} from "../src/VaultShotBalanceLedger.sol";
import {VaultShotVault} from "../src/VaultShotVault.sol";
import {VaultShotReserve} from "../src/VaultShotReserve.sol";
import {VaultShotPrizePool} from "../src/VaultShotPrizePool.sol";
import {VaultShotDrawKeeper} from "../src/VaultShotDrawKeeper.sol";

contract VaultShotTest is FhevmTest {
    uint256 constant DRAW_PERIOD = 5 minutes;
    uint64 constant TOTAL_PRIZE_PER_DRAW = 100 * 10 ** 6;
    uint64 constant RESERVE_FUNDING = 1_000 * 10 ** 6;
    uint48 constant OPERATOR_UNTIL = type(uint48).max;

    MockUSDC usdc;
    VaultShotToken cusd;
    VaultShotBalanceLedger ledger;
    VaultShotVault vault;
    VaultShotReserve reserve;
    VaultShotPrizePool prizePool;
    VaultShotDrawKeeper keeper;

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
        usdc = new MockUSDC();
        cusd = new VaultShotToken(usdc);
        ledger = new VaultShotBalanceLedger(admin.addr);
        vault = new VaultShotVault(admin.addr, cusd, ledger);
        reserve = new VaultShotReserve(admin.addr, cusd);
        prizePool = new VaultShotPrizePool(admin.addr, ledger, reserve, vault, DRAW_PERIOD, TOTAL_PRIZE_PER_DRAW);

        ledger.setAuthorizedContracts(address(vault), address(prizePool));
        reserve.setPrizePool(address(prizePool));
        vault.setPrizePool(address(prizePool));

        keeper = new VaultShotDrawKeeper(admin.addr);
        VaultShotPrizePool[] memory pools = new VaultShotPrizePool[](1);
        pools[0] = prizePool;
        keeper.setPools(pools);
        prizePool.setKeeper(address(keeper));

        // Fund and wrap the reserve's mock yield.
        usdc.adminMint(admin.addr, RESERVE_FUNDING);
        usdc.approve(address(cusd), RESERVE_FUNDING);
        cusd.wrap(admin.addr, RESERVE_FUNDING);
        cusd.setOperator(address(reserve), OPERATOR_UNTIL);
        (externalEuint64 fundHandle, bytes memory fundProof) = encryptUint64(RESERVE_FUNDING, admin.addr, address(reserve));
        reserve.fund(fundHandle, fundProof, RESERVE_FUNDING);
        vm.stopPrank();

        _fundWrapAndApprove(alice.addr, 1_000 * 10 ** 6);
        _fundWrapAndApprove(bob.addr, 1_000 * 10 ** 6);
        _fundWrapAndApprove(carol.addr, 1_000 * 10 ** 6);
    }

    function _fundWrapAndApprove(address user, uint256 amount) internal {
        vm.prank(admin.addr);
        usdc.adminMint(user, amount);

        vm.startPrank(user);
        usdc.approve(address(cusd), amount);
        cusd.wrap(user, amount);
        cusd.setOperator(address(vault), OPERATOR_UNTIL);
        vm.stopPrank();
    }

    function _deposit(Account memory user, uint64 amount) internal {
        (externalEuint64 handle, bytes memory proof) = encryptUint64(amount, user.addr, address(vault));
        vm.prank(user.addr);
        vault.deposit(handle, proof);
    }

    function _decryptLedgerBalance(Account memory user) internal returns (uint256) {
        bytes32 handle = euint64.unwrap(ledger.confidentialBalanceOf(user.addr));
        if (handle == bytes32(0)) return 0;
        bytes memory sig = signUserDecrypt(user.key, address(ledger));
        return userDecrypt(handle, user.addr, address(ledger), sig);
    }

    function _decryptTokenBalance(Account memory user) internal returns (uint256) {
        bytes32 handle = euint64.unwrap(cusd.confidentialBalanceOf(user.addr));
        if (handle == bytes32(0)) return 0;
        bytes memory sig = signUserDecrypt(user.key, address(cusd));
        return userDecrypt(handle, user.addr, address(cusd), sig);
    }

    /// @dev userDecrypt() is internal (inherited from FhevmTest), so calling it directly creates
    /// no external call frame for vm.expectRevert to intercept. This wrapper forces one.
    function _userDecryptExternal(bytes32 handle, address userAddress, address contractAddress, bytes memory sig)
        external
        returns (uint256)
    {
        return userDecrypt(handle, userAddress, contractAddress, sig);
    }

    // ---------------------------------------------------------------------
    // Wrap
    // ---------------------------------------------------------------------

    function test_wrapMintsConfidentialBalance() public {
        Account memory dave = makeAccount("dave");
        vm.prank(admin.addr);
        usdc.adminMint(dave.addr, 200 * 10 ** 6);

        vm.startPrank(dave.addr);
        usdc.approve(address(cusd), 200 * 10 ** 6);
        cusd.wrap(dave.addr, 200 * 10 ** 6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(cusd)), 200 * 10 ** 6 + RESERVE_FUNDING + 3_000 * 10 ** 6);

        bytes32 handle = euint64.unwrap(cusd.confidentialBalanceOf(dave.addr));
        bytes memory sig = signUserDecrypt(dave.key, address(cusd));
        assertEq(userDecrypt(handle, dave.addr, address(cusd), sig), 200 * 10 ** 6);
    }
}
