// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FhevmTest} from "forge-fhevm/FhevmTest.sol";
import {ERC7984Example} from "../src/ERC7984Example.sol";
import {euint64, externalEuint64} from "encrypted-types/EncryptedTypes.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

contract ERC7984ExampleTest is FhevmTest {
    ERC7984Example token;
    address tokenAddress;

    Account owner;
    Account recipient;
    Account other;

    uint64 constant INITIAL_AMOUNT = 1000;
    uint64 constant TRANSFER_AMOUNT = 100;

    function setUp() public override {
        super.setUp();

        owner = makeAccount("owner");
        recipient = makeAccount("recipient");
        other = makeAccount("other");

        vm.prank(owner.addr);
        token = new ERC7984Example(
            owner.addr, INITIAL_AMOUNT, "Confidential Token", "CTKN", "https://example.com/token"
        );
        tokenAddress = address(token);
    }

    function userDecryptAs(uint256 userPk, bytes32 handle, address contractAddress) internal returns (uint256) {
        bytes memory sig = signUserDecrypt(userPk, contractAddress);
        return userDecrypt(handle, vm.addr(userPk), contractAddress, sig);
    }

    // ---------------------------------------------------------------------
    // Initialization
    // ---------------------------------------------------------------------

    function test_setsCorrectName() public view {
        assertEq(token.name(), "Confidential Token");
    }

    function test_setsCorrectSymbol() public view {
        assertEq(token.symbol(), "CTKN");
    }

    function test_setsCorrectContractURI() public view {
        assertEq(token.contractURI(), "https://example.com/token");
    }

    function test_mintsInitialAmountToOwner() public {
        euint64 balanceHandle = token.confidentialBalanceOf(owner.addr);
        uint256 balance = userDecryptAs(owner.key, euint64.unwrap(balanceHandle), tokenAddress);
        assertEq(balance, INITIAL_AMOUNT);
    }

    // ---------------------------------------------------------------------
    // Transfer
    // ---------------------------------------------------------------------

    function test_transferFromOwnerToRecipient() public {
        (externalEuint64 encAmount, bytes memory proof) =
            encryptUint64(TRANSFER_AMOUNT, owner.addr, tokenAddress);

        vm.prank(owner.addr);
        token.confidentialTransfer(recipient.addr, encAmount, proof);

        uint256 recipientBalance =
            userDecryptAs(recipient.key, euint64.unwrap(token.confidentialBalanceOf(recipient.addr)), tokenAddress);
        uint256 ownerBalance =
            userDecryptAs(owner.key, euint64.unwrap(token.confidentialBalanceOf(owner.addr)), tokenAddress);

        assertEq(recipientBalance, TRANSFER_AMOUNT);
        assertEq(ownerBalance, INITIAL_AMOUNT - TRANSFER_AMOUNT);
    }

    function test_recipientCanTransferReceivedTokens() public {
        (externalEuint64 encAmount1, bytes memory proof1) =
            encryptUint64(TRANSFER_AMOUNT, owner.addr, tokenAddress);
        vm.prank(owner.addr);
        token.confidentialTransfer(recipient.addr, encAmount1, proof1);

        uint64 halfAmount = 50;
        (externalEuint64 encAmount2, bytes memory proof2) =
            encryptUint64(halfAmount, recipient.addr, tokenAddress);
        vm.prank(recipient.addr);
        token.confidentialTransfer(other.addr, encAmount2, proof2);

        uint256 otherBalance =
            userDecryptAs(other.key, euint64.unwrap(token.confidentialBalanceOf(other.addr)), tokenAddress);
        uint256 recipientBalance =
            userDecryptAs(recipient.key, euint64.unwrap(token.confidentialBalanceOf(recipient.addr)), tokenAddress);

        assertEq(otherBalance, halfAmount);
        assertEq(recipientBalance, TRANSFER_AMOUNT - halfAmount);
    }

    function test_revertsWhenTransferringFromZeroBalance() public {
        uint64 excessiveAmount = INITIAL_AMOUNT + 100;
        (externalEuint64 encAmount, bytes memory proof) =
            encryptUint64(excessiveAmount, recipient.addr, tokenAddress);

        vm.expectRevert(abi.encodeWithSelector(ERC7984.ERC7984ZeroBalance.selector, recipient.addr));
        vm.prank(recipient.addr);
        token.confidentialTransfer(other.addr, encAmount, proof);
    }

    function test_revertsWhenTransferringToZeroAddress() public {
        (externalEuint64 encAmount, bytes memory proof) =
            encryptUint64(TRANSFER_AMOUNT, owner.addr, tokenAddress);

        vm.expectRevert(abi.encodeWithSelector(ERC7984.ERC7984InvalidReceiver.selector, address(0)));
        vm.prank(owner.addr);
        token.confidentialTransfer(address(0), encAmount, proof);
    }

    // ---------------------------------------------------------------------
    // Confidential mint / burn
    // ---------------------------------------------------------------------

    function test_confidentialMintIncreasesBalance() public {
        uint64 mintAmount = 1_000;
        (externalEuint64 encAmount, bytes memory proof) =
            encryptUint64(mintAmount, owner.addr, tokenAddress);

        vm.prank(owner.addr);
        token.confidentialMint(recipient.addr, encAmount, proof);

        uint256 recipientBalance =
            userDecryptAs(recipient.key, euint64.unwrap(token.confidentialBalanceOf(recipient.addr)), tokenAddress);
        assertEq(recipientBalance, mintAmount);
    }

    function test_confidentialMintRevertsForNonOwner() public {
        uint64 mintAmount = 1_000;
        (externalEuint64 encAmount, bytes memory proof) =
            encryptUint64(mintAmount, other.addr, tokenAddress);

        vm.expectRevert();
        vm.prank(other.addr);
        token.confidentialMint(recipient.addr, encAmount, proof);
    }

    function test_confidentialBurnDecreasesBalance() public {
        uint64 burnAmount = 250;
        (externalEuint64 encAmount, bytes memory proof) =
            encryptUint64(burnAmount, owner.addr, tokenAddress);

        vm.prank(owner.addr);
        token.confidentialBurn(owner.addr, encAmount, proof);

        uint256 ownerBalance =
            userDecryptAs(owner.key, euint64.unwrap(token.confidentialBalanceOf(owner.addr)), tokenAddress);
        assertEq(ownerBalance, INITIAL_AMOUNT - burnAmount);
    }

    function test_confidentialBurnRevertsForNonOwner() public {
        uint64 burnAmount = 250;
        (externalEuint64 encAmount, bytes memory proof) =
            encryptUint64(burnAmount, other.addr, tokenAddress);

        vm.expectRevert();
        vm.prank(other.addr);
        token.confidentialBurn(owner.addr, encAmount, proof);
    }
}
