import { workspace } from 'vscode';
import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';
import { Duplex } from 'stream';
import { getConfig } from '../configuration';
import { execSync } from 'child_process';

let cachedProxy: { url: string | undefined; time: number } | null = null;

export function getProxyUrl(): string | undefined {
    // 1. Extension configuration: commentTranslate.proxy
    const extProxy = getConfig<string>('proxy', '');
    if (extProxy) return extProxy;

    // 2. VS Code http.proxy
    const vscodeProxy = workspace.getConfiguration('http').get<string>('proxy');
    if (vscodeProxy) return vscodeProxy;

    // 3. Environment variables
    const envProxy =
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy ||
        process.env.ALL_PROXY ||
        process.env.all_proxy;
    if (envProxy) return envProxy;

    // 4. Windows system proxy (cached for 15s to avoid frequent execSync)
    if (process.platform === 'win32') {
        const now = Date.now();
        if (cachedProxy && now - cachedProxy.time < 15000) {
            return cachedProxy.url;
        }

        try {
            const enableOut = execSync(
                'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable',
                { encoding: 'utf8', timeout: 500, windowsHide: true }
            );
            if (enableOut.includes('0x1')) {
                const serverOut = execSync(
                    'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
                    { encoding: 'utf8', timeout: 500, windowsHide: true }
                );
                const match = serverOut.match(/ProxyServer\s+REG_SZ\s+(.+)/);
                if (match && match[1]) {
                    let server = match[1].trim();
                    if (server.includes('=')) {
                        const httpsMatch = server.match(/https=([^;]+)/) || server.match(/http=([^;]+)/);
                        server = httpsMatch ? httpsMatch[1] : server.split(';')[0];
                    }
                    const url = server.startsWith('http') ? server : `http://${server}`;
                    cachedProxy = { url, time: now };
                    return url;
                }
            }
        } catch (e) {
            // ignore
        }
        cachedProxy = { url: undefined, time: now };
    }

    return undefined;
}

export class SimpleHttpsProxyAgent extends https.Agent {
    constructor(private proxyUrl: string, options?: https.AgentOptions) {
        super({ keepAlive: true, ...options });
    }

    override createConnection(options: any, callback?: (err: Error | null, stream: Duplex) => void): Duplex | null | undefined {
        try {
            const parsed = new URL(this.proxyUrl);
            const proxyPort = Number(parsed.port) || 80;
            const proxyHost = parsed.hostname;

            const connectReq = http.request({
                host: proxyHost,
                port: proxyPort,
                method: 'CONNECT',
                path: `${options.host}:${options.port || 443}`,
                headers: {
                    Host: `${options.host}:${options.port || 443}`,
                    ...(parsed.username ? {
                        'Proxy-Authorization': 'Basic ' + Buffer.from(`${parsed.username}:${parsed.password}`).toString('base64')
                    } : {})
                }
            });

            connectReq.on('connect', (res, socket) => {
                if (res.statusCode === 200) {
                    const tlsSocket = tls.connect({
                        socket,
                        servername: options.servername || options.host
                    });
                    callback?.(null, tlsSocket);
                } else {
                    callback?.(new Error(`Proxy CONNECT error: ${res.statusCode} ${res.statusMessage}`), socket);
                }
            });

            connectReq.on('error', (err) => {
                callback?.(err, undefined as any);
            });

            connectReq.end();
            return undefined;
        } catch (err: any) {
            callback?.(err, undefined as any);
            return undefined;
        }
    }
}

export function getProxyAgent(): https.Agent | undefined {
    const proxyUrl = getProxyUrl();
    if (!proxyUrl) return undefined;
    return new SimpleHttpsProxyAgent(proxyUrl);
}
