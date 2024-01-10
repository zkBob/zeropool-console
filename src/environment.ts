import { Chains, Pools, SnarkConfigParams, Parameters, ZkAddressPrefix } from 'zkbob-client-js';

export interface TokenMigrationConfig {
    tokenAddress: string;
    firstTimestamp?: number;
    lastTimestamp: number;
}

export interface ConsoleConfig {
    defaultPool: string;
    pools: Pools;
    chains: Chains;
    extraPrefixes?: ZkAddressPrefix[];
    globalSnarks?: SnarkConfigParams;
    snarkParamsSet?: Parameters;
    blockExplorerUrls: {[chainId: string]: {tx: string, address: string} };
    minters: {[poolName: string]: string };
    cloudApi: {[poolName: string]: string };
    redemptionUrls: {[poolName: string]: string };
    migrations: {[poolName: string]: {
        oldTokens: {[oldTokenName: string]: TokenMigrationConfig}
    }};
}

export const env = await readConfig();

async function readConfig(): Promise<ConsoleConfig> {
    const isDev = process.env.NODE_ENV === 'development' ? true : false;
    const cfgFile = isDev ? process.env.CONFIG_JSON : CONFIG_JSON;
    if (cfgFile) {
        const logMsg = `Reading config from the file: ${cfgFile}${isDev ? ' [dev environment]' : ''}`
        console.time(logMsg);
        try {
            const res = await (await fetch(cfgFile, { headers: { 'Cache-Control': 'no-cache' } })).json();
            console.timeEnd(logMsg);

            return res;
        } catch(err) {
            throw new Error(`Unable to load client configuration: ${err.message}`);
        }
    } else {
        throw new Error(`Config file is not set. The app cannot be used without it`);
    }
}