import { Chains, Pools, SnarkConfigParams } from 'zkbob-client-js';

export interface ConsoleConfig {
    defaultPool: string;
    pools: Pools;
    chains: Chains;
    blockExplorerUrls: {[chainId: string]: {tx: string, address: string} };
    globalSnarks: SnarkConfigParams;
    minters: {[poolName: string]: string };
    cloudApi: {[poolName: string]: string };
    redemptionUrls: {[poolName: string]: string };
}

export const env = await readConfig();

async function readConfig(): Promise<ConsoleConfig> {
    const isDev = process.env.NODE_ENV === 'development' ? true : false;
    const cfgFile = isDev ? process.env.CONFIG_JSON : CONFIG_JSON;
    const logMsg = `Reading config from the file: ${cfgFile}${isDev ? ' [dev environment]' : ''}`
    console.time(logMsg);
    try {
        const res = await (await fetch(cfgFile, { headers: { 'Cache-Control': 'no-cache' } })).json();
        console.timeEnd(logMsg);

        return res;
    } catch(err) {
        throw new Error(`Unable to load client configuration: ${err.message}`);
    }
}