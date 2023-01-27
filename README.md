# zkBob Web Console

The simple tool to test and demonstrate zkBob solution possibilities 

# Running locally

Make sure you are using node js version higher or equal than `14.0.0`. The repo has been tested with `node v16.14.1` and `npm v8.5.0`

1. Clone repository and install dependencies

```bash
git clone https://github.com/zkBob/zkbob-console.git
cd zkbob-console
yarn install
```

2. Set appropriated settings in the `.env` file

3. Put circuit parameters and keys in `asset` folder. The same files should be located on relayer node

4. Run local bundle
```
yarn dev
```
5. Open your browser and enter [http://localhost:3000/](http://localhost:3000/) in the address line

It's recommended to clear your browser's history and cookies in case of you was used previous version of console

# Creating Docker container

Suppose you already done local running and set appropriated parameters and settings

1. Fix your docker ID in [this line](https://github.com/zkBob/zkbob-console/blob/0053ca2a63d00fd4be4e9bd646c05ffbdc2ecf3e/scripts/publish-docker#L4)

2. Build the prouction pack and push your container to the Docker Hub: `./scripts/publish-docker`


# Using console

## Account maintenance

`get-seed <password>` print the seed phrase for the current account (current password needed)

`get-sk <password>` get zkBob account spending key (current password needed,
  
## L1-level commands

`get-addres` get the linked account address. This address derived from account mnemonic phrase

`get-balance` get the linked account balance (native coins)

`get-token-balance` get the linked account balance (tokens)

`testnet-mint <amount>` mint some unshielded tokens (available on testnets only)

`transfer <to> <amount>` transfer native coins to the destination L1 address

`transfer-token <to> <amount>` transfer tokens to the destination L1 address

## L2-level commands

`gen-shielded-address` generate a new zkBob shielded address

`get-shielded-balance` get calculated private balance (with optimistic balance)

`deposit-shielded <amount> [times]` deposit some tokens into zk-account (approving allowance scheme which require native coins presenting on the balance to cover token approve transaction fee). Specify `times` numeric value to repeat the operation several times

`deposit-shielded-permittable <amount> [times]` deposit some tokens into zk-account (permit scheme, no native coins needed). Specify `times` numeric value to repeat the operation several times

`deposit-shielded-permittable-ephemeral <amount> <index>` deposit some tokens from the internal ephemeral address (permit scheme)

`transfer-shielded <shielded address> <amount> [times | +]` move shielded tokens to the another zkBob account (inside a pool). You can specify `times` numeric value to repeat the operation several times ***OR*** enter the multitransfer mode with adding `+` sign at the end of the command

`withdraw-shielded <amount> [address] [times]` withdraw shielded tokens from the zk accouint to the native address (to the your account if address is ommited). Specify `times` numeric value to repeat the operation several times

`history` print all transactions related to your account

## Transactions configuration

`max-transfer` calculate maximum available token amount for outcoming transaction (transfer or withdrawal)

`tx-amounts <amount> [fee] [+]`, get transfer\withdrawal configuration for specified amount ant fee per transaction. Type `+` sign at the end of the command to enter the multitransfer mode

`fee-estimate-deposit <amount>` estimate fee for depositing requested amount of tokens

`fee-estimate-transfer <amount> [amount2 amount3 ...]' estimate fee for transfering requested amount of tokens. Add additional token amounts (the only space accepted as a separator) to estimate fee for multitransfer mode

`fee-estimate-withdraw <amount>` estimate fee for withdrawing requested amount of tokens

`limits [address]` get pool contract limits for the specified address (linked account address will be used by default)

## Service commands

`shielded-address-info <shielded address>` get all available info for the shielded address

`internal-state` print your account and incoming notes (internal representation, for debug purposes only)

`root [index]` print local and remote Merkle tree root or retrieve just local one at the specified index (local and remote roots should be tha same for same indicies)

`siblings <index>` get left siblings at specified index (partial tree support). The index should be multiple of 128 and less than current index
 
`rollback <index>` rollback the user's state to the specified index (the index should be multiple of 128 and less than current index)

`sync` force synchronize user's state
    
`sync-stat` print available state synchronization statistics from the library

`get-ephemeral-address [index]` get the concrete ephemeral address or show first unused one

`get-ephemeral-used` show all used ephemeral addresses

`get-ephemeral-address-privkey <index>` get private key for concrete ephemeral address

`wipe-state` wipe internal state and history

`set-prover-mode <mode>` set prover mode (possible modes: Local, Delegated, DelegatedWithFallback)

`prover-info` print info about the used prover

`clear` clear the terminal

`reset` log out from the current account

`account-id` get the current account unique id'

`support-id` print current support id (changed on each library initialization)

`version` print console and relayer versions

`environment` print environment variables

`help` display CLI commands list

`tutorial` print usage example
