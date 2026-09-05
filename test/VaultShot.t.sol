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

    // ---------------------------------------------------------------------
    // Deposit
    // ---------------------------------------------------------------------

    function test_depositCreditsEncryptedBalance() public {
        _deposit(alice, 100 * 10 ** 6);

        assertEq(_decryptLedgerBalance(alice), 100 * 10 ** 6);
        assertEq(ledger.depositorsCount(), 1);
        assertEq(_decryptTokenBalance(alice), 900 * 10 ** 6);
    }

    /// @dev All four Ledger balance aliases must return the exact same handle.
    function test_allBalanceAliasesReturnSameHandle() public {
        _deposit(alice, 100 * 10 ** 6);

        bytes32 h1 = euint64.unwrap(ledger.confidentialBalanceOf(alice.addr));
        bytes32 h2 = euint64.unwrap(ledger.seeConfidentialBalance(alice.addr));
        bytes32 h3 = euint64.unwrap(ledger.getEncryptedBalance(alice.addr));
        bytes32 h4 = euint64.unwrap(ledger.balanceOfEncrypted(alice.addr));
        assertEq(h1, h2);
        assertEq(h1, h3);
        assertEq(h1, h4);

        bytes memory sig = signUserDecrypt(alice.key, address(ledger));
        assertEq(userDecrypt(h4, alice.addr, address(ledger), sig), 100 * 10 ** 6);
    }

    function test_batchEncryptedBalancesReader() public {
        _deposit(alice, 100 * 10 ** 6);
        _deposit(bob, 50 * 10 ** 6);

        address[] memory accounts = new address[](2);
        accounts[0] = alice.addr;
        accounts[1] = bob.addr;
        euint64[] memory balances = ledger.getEncryptedBalances(accounts);

        bytes memory aliceSig = signUserDecrypt(alice.key, address(ledger));
        bytes memory bobSig = signUserDecrypt(bob.key, address(ledger));
        assertEq(userDecrypt(euint64.unwrap(balances[0]), alice.addr, address(ledger), aliceSig), 100 * 10 ** 6);
        assertEq(userDecrypt(euint64.unwrap(balances[1]), bob.addr, address(ledger), bobSig), 50 * 10 ** 6);
    }

    function test_multipleDepositsAccumulate() public {
        _deposit(alice, 100 * 10 ** 6);
        _deposit(alice, 50 * 10 ** 6);

        assertEq(_decryptLedgerBalance(alice), 150 * 10 ** 6);
        assertEq(ledger.depositorsCount(), 1);
    }

    function test_depositRevertsWithoutOperatorApproval() public {
        address dave = makeAddr("dave");
        vm.prank(admin.addr);
        usdc.adminMint(dave, 100 * 10 ** 6);
        vm.startPrank(dave);
        usdc.approve(address(cusd), 100 * 10 ** 6);
        cusd.wrap(dave, 100 * 10 ** 6);
        vm.stopPrank();
        // dave never set the vault as an operator.

        (externalEuint64 handle, bytes memory proof) = encryptUint64(100 * 10 ** 6, dave, address(vault));
        vm.expectRevert(
            abi.encodeWithSignature("ERC7984UnauthorizedSpender(address,address)", dave, address(vault))
        );
        vm.prank(dave);
        vault.deposit(handle, proof);
    }

    // ---------------------------------------------------------------------
    // Withdraw (single transaction, at any time)
    // ---------------------------------------------------------------------

    function test_withdrawReturnsFullBalanceInOneTransaction() public {
        _deposit(alice, 100 * 10 ** 6);

        uint256 tokenBalanceBefore = _decryptTokenBalance(alice);

        vm.prank(alice.addr);
        vault.withdraw();

        assertEq(_decryptLedgerBalance(alice), 0);
        assertEq(_decryptTokenBalance(alice), tokenBalanceBefore + 100 * 10 ** 6);
    }

    function test_withdrawBeforeDrawReturnsExactPrincipal() public {
        _deposit(alice, 300 * 10 ** 6);
        // No draw has run — withdrawing now must return exactly principal, no more, no less.

        vm.prank(alice.addr);
        vault.withdraw();

        assertEq(_decryptTokenBalance(alice), 1_000 * 10 ** 6);
    }

    /// @dev A user who never deposited has an uninitialized (never-computed) FHE handle for their
    /// balance — there's no meaningful "zero ciphertext" to transfer, so this reverts rather than
    /// silently no-op'ing. Degenerate case, not a normal user path.
    function test_withdrawWithZeroBalanceReverts() public {
        vm.prank(alice.addr);
        vm.expectRevert();
        vault.withdraw();
    }
}
