import './styles.css';
import jQuery from 'jquery';
// // @ts-ignore
// import initTerminal from 'imports-loader?additionalCode=var%20define=false;!jquery.terminal';
// // @ts-ignore
// import initAutocomplete from 'imports-loader?additionalCode=var%20define=false;!jquery.terminal/js/autocomplete_menu';
//@ts-ignore
import initTerminal from 'jquery.terminal';
// import initAutocomplete from 'jquery.terminal/js/autocomplete_menu';
import bip39 from 'bip39-light';

var pjson = require('../package.json');


import { Account, InitAccountCallback, InitAccountState, InitAccountStatus } from './account';
import * as c from './commands';
import { env } from './environment';

const PRIVATE_COMMANDS = [
  'set-seed',
  'get-seed',
  'get-private-key',
];

const COMMANDS: { [key: string]: [(...args) => void, string, string] } = {

  'pools': [c.getAvailablePools, '', 'list of the available pools'],
  'switch-pool': [c.switchPool, '<pool_alias> <password>', 'switch to the another pool with the current spending key'],
  'get-seed': [c.getSeed, '<password>', 'print the seed phrase for the current account'],
  'get-sk': [c.getSk, '<password>', 'get zkBob account spending key'],
  'get-address': [c.getAddress, '', 'get your native address'],
  'get-balance': [c.getBalance, '', 'fetch and print native account balance'],
  'get-token-balance': [c.getTokenBalance, '', 'get token balance (unshielded)'],
  'testnet-mint': [c.mint, ' <amount>', 'mint some unshielded tokens'],
  'transfer': [c.transfer, ' <to> <amount>', ' transfer native coins to the destination'],
  'transfer-token': [c.transferToken, ' <to> <amount>', 'transfer unshielded tokens to the destination account'],
  'approve-token': [c.approveToken, ' <spender> <amount>', 'approve allowance to spend your token for the specified spender'],
  'gen-shielded-address': [c.genShieldedAddress, '[number]', 'generate a new zkBob shielded address for the current pool (or several addressed)'],
  'gen-shielded-address-generic': [c.genShieldedAddressUniversal, '[number]', 'generate a new zkBob universal shielded address (or several addressed)'],
  'get-shielded-balance': [c.getShieldedBalance, '', 'get calculated private balance'],
  'deposit-shielded': [c.depositShielded, '<amount> [times]', 'shield some tokens [via approving allowance]'],
  'deposit-shielded-permittable': [c.depositShieldedPermittable, '<amount> [times]', 'shield some tokens [via permit]'],
  'deposit-shielded-permittable-ephemeral': [c.depositShieldedPermittableEphemeral, '<amount> <index>', 'shield some tokens from the internal ephemeral address [via permit]'],
  'direct-deposit': [c.directDeposit, '<shielded address> <amount> [times]', 'send tokens to the pool directly to receive it on the specified zkAddress'],
  'transfer-shielded': [c.transferShielded, '<shielded address> <amount> [times | +]', 'move shielded tokens to the another zkBob address (inside a pool)'],
  'transfer-shielded-multinote': [c.transferShieldedMultinote, '<shielded address> <amount> <count> [times]', 'send a set of (notes) to the single address'],
  'withdraw-shielded': [c.withdrawShielded, '<amount> [address] [times]', 'withdraw shielded tokens to the native address (to the your account if the address is ommited)'],
  'history': [c.printHistory, '', 'print all transactions related to your account'],
  'max-transfer': [c.getMaxAvailableTransfer, '', 'get max available token amount for outcoming transaction'],
  'tx-amounts': [c.getTxParts, '<amount> [fee] [+]', 'get transfer component transactions'],
  'fee-estimate-deposit': [c.estimateFeeDeposit, '<amount>', 'estimate fee for depositing requested amount of tokens'],
  'fee-estimate-transfer': [c.estimateFeeTransfer, '<amount> [amount2 amount3 ...]', 'estimate fee for transfering requested amount of tokens'],
  'fee-estimate-withdraw': [c.estimateFeeWithdraw, '<amount>', 'estimate fee for withdrawing requested amount of tokens'],
  'limits': [c.getLimits, '[address]', 'get maximum available deposit and withdrawal from the specified address'],
  'shielded-address-info': [c.shieldedAddressInfo, '<shielded address>', 'get all available info for the shielded address'],
  'internal-state': [c.getInternalState, '', 'print your account and incoming notes'],
  'root': [c.getRoot, '[index]', 'print the latest local and remote Merkle tree root, or retrieve just local one at the specified index'],
  'siblings': [c.getLeftSiblings, '<index>', 'get left siblings at specified index (partial tree support)'],
  'rollback': [c.rollback, '<index>', 'rollback the user\'s state to the specified index'],
  'sync': [c.syncState, '', 'force synchronize user\'s state'],
  'sync-stat': [c.getStateSyncStatistic, '', 'print available state synchronization statistics from the library'],
  'get-ephemeral-address': [c.getEphemeral, '[index]', 'get the concrete ephemeral address or show first unused one'],
  'get-ephemeral-used': [c.getEphemeralUsed, '', 'show used ephemeral addresses'],
  'get-ephemeral-address-privkey': [c.getEphemeralPrivKey, '<index>', 'get private key for concrete ephemeral address'],
  'wipe-state': [c.cleanState, '', 'wipe internal state and history'],
  'set-prover-mode': [c.setProverMode, '<mode>', 'set prover mode (possible modes: Local, Delegated, DelegatedWithFallback)'],
  'prover-info': [c.getProverInfo, '', 'print info about the used prover'],
  'clear': [c.clear, '', 'clear the terminal'],
  'reset': [c.reset, '', 'log out from the current account'],
  'account-id': [c.getAccountId, '', 'get the client account id (indexed DB name)'],
  'support-id': [c.getSupportId, '', 'get the client support id'],
  'version': [ c.getVersion, '', 'get console and relayer versions'],
  'gift-card-generate':[c.generateGiftCardLocal, '<balance>', 'creates a single burner wallet with specified balance and returns redemption url and qr code'],
  'gift-card-generate-cloud':[c.generateGiftCards,'<alias> <quantity> <balance> <token>','generate gift cards via cloud (you should provide cloud access token)'],
  'gift-card-balance': [c.giftCardBalance, '<code_or_redemption_url>', 'retrieve gift card balance'],
  'gift-card-redeem': [c.redeemGiftCard, '<code_or_redemption_url>', 'redeem gift card to the current account'],
  'environment': [c.currentPoolEnvironment, '', 'get environment constants'],
  'help': [
    function () {
      let message = '\nAvailable commands:\n' + Object.entries(COMMANDS)
        .map(([name, values]) => {
          const [fn, args, desc] = values;
          let line = `    ${name}`;

          if (args && args.length > 0) {
            line += ` ${args}`;
          }

          if (desc && desc.length > 0) {
            line += ` - [[;gray;]${desc}]`;
          }

          return line;
        })
        .join('\n');
      message += '\n';
      this.echo(message);
    },
    '',
    'print help message'
  ],
  'tutorial': [
    function () {
      const message = String.raw`
<p>
NOTE: You don't need native coins for the most of the commands<br>
(excepting minting tokens and making deposit via approve)<br>
</p>

<p>
  <h4>Usage example:</h4>
  <br>
  <div class="comment">// Get your native address to transfer few tokens here</div>
  <div class="comment">// e.g. you can ask someone transfer a few tokens for you</div>
  <div class="comment">// or deposit native coins to mint test tokens</div>
  <div class="command-example">get-address</div>
  <br>
  <div class="comment">// Mint 10 tokens for the account</div>
  <div class="comment">// (you need native coins to cover the relayer's fee)</div>
  <div class="command-example">testnet-mint ^10</div>
  <br>
  <div class="comment">// Make sure your token balance was deposited</div>
  <div class="command-example">get-token-balance</div>
  <br>
  <div class="comment">// Deposit 5 of those tokens to the pool</div>
  <div class="command-example">deposit-shielded-permittable ^5</div>
  <br>
  <div class="comment">// Generate a new shielded address</div>
  <div class="command-example">gen-shielded-address</div>
  <br>
  <div class="comment">// Transfer 3 of deposited tokens the specified address</div>
  <div class="command-example">transfer-shielded "destination shielded address" ^3</div>
  <br>
  <div class="comment">// Withdraw ^1 from the pool</div>
  <div class="command-example">withdraw-shielded ^1 [optional_external_address]</div>
  <br>
  <div class="comment">// Check your shielded balance</div>
  <div class="command-example">get-shielded-balance</div>
  <br>
  <div class="comment">// Print transactions history</div>
  <div class="command-example">history</div>
</p>
`;
      this.echo(message, { raw: true });
    },
    '',
    'print usage example'
  ]
};

const GREETING = String.raw`
     _   ______       _     
    | |  | ___ \     | |    
 ___| | _| |_/ / ___ | |__  
|_  / |/ / ___ \/ _ \| '_ \ 
 / /|   <| |_/ / (_) | |_) |
/___|_|\_\____/ \___/|_.__/ 
                      [[;white;]v${pjson.version}]
    `;

jQuery(async function ($) {
  initTerminal($);
  // initAutocomplete($);

  const commands = {};
  for (const [name, values] of Object.entries(COMMANDS)) {
    commands[name] = values[0];
  }

  const options = {
    greetings: GREETING,
    checkArity: false,
    processArguments: false,
    completion: function(_, callback) {
      if (this.get_command().match(/^set-prover-mode /)) {
        callback(['Local', 'Delegated', 'DelegatedWithFallback']);
      } else if (this.get_command().match(/^switch-pool /)) {
        callback(Object.keys(env.pools));
      } else if (this.get_command().match(/^[a-z\-]*$/)) {
        callback(Object.keys(COMMANDS));
      }
    },
    anyLinks:true,
    historyFilter: function (command) {
      return PRIVATE_COMMANDS.indexOf(command) == -1;
    },
    exceptionHandler: function (err) {
      this.resume();
      this.exception(err);
    },
    onInit: async function () {
      do {
        try {

          this.pause();
          let clientReady = true;
          if (!this.account) {
            clientReady = false;
            let initAccCallback: InitAccountCallback = async (status: InitAccountStatus) => {
              switch(status.state) {
                case InitAccountState.ClientInitializing:
                  this.echo('Initializing client...');
                  break;

                case InitAccountState.AccountlessClientReady:
                  this.update(-1, 'Initializing client...[[;green;]OK]');
                  this.echo(`Current pool:    ${await this.account.getCurrentPool()}`);
                  if (this.account.getPools().length > 1) {
                    this.echo(`Supported pools: ${await this.account.getPools().join(', ')}`);
                  }
                  this.echo(`Library version: ${await this.account.libraryVersion()}`);
                  this.echo(`Relayer version: ...requesting...`);
                  const relayerVer = await this.account.relayerVersion();
                  this.update(-1, `Relayer version: ${relayerVer.ref} (${relayerVer.commitHash})\n`);
                  clientReady = true;
                  break;

                case InitAccountState.AccountInitializing:
                  //this.echo(`Initializing account...`);
                  break;

                case InitAccountState.FullClientReady:
                  this.update(-1, `Initializing account...[[;green;]OK]`);
                  break;

                case InitAccountState.Failed:
                  this.echo(`[[;red;]Error occured: ${this.account?.initError?.message ?? 'unknown error'}]`);
                default: break;
              }
            };
            this.account = new Account(initAccCallback);
          }

          while(!clientReady) {
            await new Promise(f => setTimeout(f, 50));
          }
          this.resume();

          // Account prompt
          const accountName = await this.read('Enter account name (new or existing): ');

          if (accountName.trim().length == 0) {
            throw new Error('Account name cannot be empty');
          }

          if (this.account.isAccountPresent(accountName)) {
            this.set_mask(true);
            const password = await this.read('Enter password: ');
            this.set_mask(false);

            this.echo(`Initializing account...`);

            this.pause();
            await this.account.attachExistingAccount(accountName, password);
            this.resume();
          } else {
            let seed = await this.read(`Enter seed phrase or leave empty to generate a new one: `);

            let isNewAccount = false;
            if (seed.trim().length == 0) {
              seed = bip39.generateMnemonic();
              this.echo(`New mnemonic: ${seed}`);
              isNewAccount = true;
            } else if (!bip39.validateMnemonic(seed)) {
              throw new Error('Invalid seed phrase');
            }

            this.set_mask(true);
            const password = (await this.read('Enter new password: ')).trim();
            this.set_mask(false);

            // TODO: Proper complexity check
            if (password.length < 4) {
              throw new Error('Password is too weak');
            }

            this.echo(`Creating new account...`);

            this.pause();
            await this.account.attachAccount(accountName, seed, password, isNewAccount);
            this.resume();
          }
        } catch (e) {
          this.resume();
          this.error(e);
          console.error(e);
        }
      } while (!this.account || !this.account.hasActiveAccount());

      this.clear();
      this.echo(GREETING);
      if (this.account.getPools().length == 1) {
        this.echo(`Welcome to the zkBob console for ${this.account.networkName()}`);
      } else {
        this.echo(`Welcome to the multipool zkBob console`);
      }
      this.echo('');
      this.echo('Amounts are interpreted as Wei by default');
      this.echo('If you want to specify human-readable decimal value pls add [[;white;]^] prefix');
      this.echo('e.g.: ^1.234 = 1234000000000000000, ^5 = 5000000000000000000');
      this.echo('');
      this.echo('Enter [[;white;]help] for more info on available commands');
      this.echo('Enter [[;white;]tutorial] to display usage example');
      this.echo('');
      //COMMANDS['intro'][0].apply(this);
    },
    prompt: function () {
      if (this.account) {
        if (this.account.accountName) {
          return `[[;gray;]${this.account.accountName}(${this.account.networkName()})>] `;
        } else {
          return `[[;gray;]${this.account.networkName()}>] `;
        }
      } else {
        return '';
      }
    },
  };

  // jquery.terminal doesn't have proper type definitions for async commands
  // @ts-ignore
  $('#terminal').terminal(commands, options);
});
