#!/usr/bin/env node
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const WebSocket = require('ws');
const axios = require('axios');
const net = require('net');
const dgram = require('dgram');

function createTunnel(options) {
    return new Promise((resolve, reject) => {
        const {
            port,
            subdomain = null,
            host = 'localhost',
            protocol = 'http',
            server = 'wss://tunnel.labcore.es'
        } = options;

        if (!port) {
            return reject(new Error('You must specify a port.'));
        }

        let reconnectInterval = 3000;
        let tcpSockets = new Map(); // connectionId -> socket
        let udpSockets = new Map(); // clientId -> socket
        let ws;
        let isClosed = false;
        let hasResolved = false;

        function connectTunnel() {
            if (isClosed) return;
            console.log(`🔌 Connecting to ${server}...`);
            ws = new WebSocket(server);

            ws.on('open', () => {
                if (protocol === 'http') {
                    console.log(`Requesting HTTP tunnel${subdomain ? ` for '${subdomain}'` : ''}...`);
                } else {
                    console.log(`Requesting ${protocol.toUpperCase()} tunnel...`);
                }
                ws.send(JSON.stringify({ type: 'register', proto: protocol, subdomain: subdomain }));
            });

            ws.on('message', (message) => {
                let data;
                try { data = JSON.parse(message); } catch (e) { return; }

                if (data.type === 'error') {
                    console.error(`❌ Error: ${data.message}`);
                    if (!hasResolved) {
                        reject(new Error(data.message));
                    } else {
                        process.exit(1);
                    }
                    return;
                }

                if (data.type === 'registered') {
                    console.log(`\n======================================================`);
                    console.log(`🚀 Public Tunnel Established!`);
                    console.log(`🏠 Local Server : ${protocol}://${host}:${port}`);
                    console.log(`🌐 Public URL   : ${data.url}`);
                    console.log(`======================================================\n`);
                    console.log(`Receiving traffic...\n`);

                    if (!hasResolved) {
                        hasResolved = true;
                        resolve({
                            url: data.url,
                            close: () => {
                                isClosed = true;
                                if (ws) ws.close();
                                for (const socket of tcpSockets.values()) socket.destroy();
                                tcpSockets.clear();
                                for (const socket of udpSockets.values()) socket.close();
                                udpSockets.clear();
                                console.log('Tunnel closed programmatically.');
                            }
                        });
                    }
                }

                // HTTP HANDLING
                if (data.type === 'request') {
                    const reqData = data;
                    console.log(`[>>] ${reqData.method} ${reqData.url}`);
                    axios({
                        method: reqData.method,
                        url: `http://${host}:${port}${reqData.url}`,
                        headers: reqData.headers,
                        data: reqData.bodyBase64 ? Buffer.from(reqData.bodyBase64, 'base64') : null,
                        responseType: 'arraybuffer',
                        validateStatus: () => true,
                        timeout: 25000
                    }).then(response => {
                        console.log(`[<<] ${response.status} ${reqData.method} ${reqData.url}`);
                        ws.send(JSON.stringify({
                            type: 'response', requestId: reqData.requestId,
                            status: response.status, headers: response.headers,
                            body: response.data ? Buffer.from(response.data).toString('base64') : '',
                            isBase64: true
                        }));
                    }).catch(error => {
                        let errorHtml = `<h2>502 Bad Gateway</h2><p>Error connecting to ${host}:${port}</p>`;
                        if (error.code === 'ECONNREFUSED') console.log(`[!!] WARNING: Connection refused at ${host}:${port}`);
                        ws.send(JSON.stringify({ type: 'response', requestId: reqData.requestId, status: 502, headers: { 'Content-Type': 'text/html' }, body: Buffer.from(errorHtml, 'utf-8').toString('base64'), isBase64: true }));
                    });
                }

                // TCP HANDLING
                if (data.type === 'tcp-connect') {
                    console.log(`[>>] New TCP connection established.`);
                    const socket = net.createConnection({ port: port, host: host }, () => {});
                    tcpSockets.set(data.connectionId, socket);

                    socket.on('data', (buf) => {
                        ws.send(JSON.stringify({ type: 'tcp-data', connectionId: data.connectionId, data: buf.toString('base64') }));
                    });
                    socket.on('close', () => {
                        console.log(`[<<] TCP connection closed.`);
                        ws.send(JSON.stringify({ type: 'tcp-disconnect', connectionId: data.connectionId }));
                        tcpSockets.delete(data.connectionId);
                    });
                    socket.on('error', (err) => {
                        console.log(`[!!] TCP Error: ${err.message}`);
                        ws.send(JSON.stringify({ type: 'tcp-disconnect', connectionId: data.connectionId }));
                        tcpSockets.delete(data.connectionId);
                    });
                }
                if (data.type === 'tcp-data') {
                    const socket = tcpSockets.get(data.connectionId);
                    if (socket && !socket.destroyed) {
                        socket.write(Buffer.from(data.data, 'base64'));
                    }
                }
                if (data.type === 'tcp-disconnect') {
                    const socket = tcpSockets.get(data.connectionId);
                    if (socket) {
                        socket.destroy();
                        tcpSockets.delete(data.connectionId);
                    }
                }

                // UDP HANDLING
                if (data.type === 'udp-data') {
                    let socket = udpSockets.get(data.clientId);
                    if (!socket) {
                        console.log(`[>>] New UDP stream from ${data.clientId}`);
                        socket = dgram.createSocket('udp4');
                        udpSockets.set(data.clientId, socket);

                        socket.on('message', (msg) => {
                            ws.send(JSON.stringify({ type: 'udp-data', clientId: data.clientId, data: msg.toString('base64') }));
                        });
                        socket.on('error', (err) => {
                            console.log(`[!!] UDP Error: ${err.message}`);
                            socket.close();
                            udpSockets.delete(data.clientId);
                        });
                    }
                    socket.send(Buffer.from(data.data, 'base64'), port, host === 'localhost' ? '127.0.0.1' : host);
                }
            });

            ws.on('close', () => {
                if (isClosed) return;
                console.log(`\n❌ Connection lost. Reconnecting in ${reconnectInterval/1000}s...`);
                // Clean up sockets
                for (const socket of tcpSockets.values()) socket.destroy();
                tcpSockets.clear();
                for (const socket of udpSockets.values()) socket.close();
                udpSockets.clear();
                
                setTimeout(connectTunnel, reconnectInterval);
            });

            ws.on('error', () => {});
        }

        connectTunnel();
    });
}

if (require.main === module) {
    const argv = yargs(hideBin(process.argv))
      .usage('Usage: labtunnel <port> [options]')
      .command('$0 <port>', 'Start the tunnel', (yargs) => {
          yargs.positional('port', { describe: 'Local server port to expose', type: 'number' });
      })
      .option('s', { alias: 'subdomain', type: 'string', describe: 'Request a custom subdomain' })
      .option('host', { type: 'string', describe: 'Local IP/hostname to forward to', default: 'localhost' })
      .option('tcp', { type: 'boolean', describe: 'Tunnel TCP traffic (Games, Databases, SSH)' })
      .option('udp', { type: 'boolean', describe: 'Tunnel UDP traffic (Real-time games, VoIP)' })
      .example('labtunnel 3000', 'HTTP web server (random subdomain)')
      .example('labtunnel 3000 -s my-app', 'HTTP web server (custom subdomain)')
      .example('labtunnel 25565 --tcp', 'TCP server (random subdomain)')
      .example('labtunnel 25565 --tcp -s my-server', 'TCP server (custom subdomain)')
      .example('labtunnel 7777 --udp', 'UDP server (random subdomain)')
      .example('labtunnel 7777 --udp -s my-game', 'UDP server (custom subdomain)')
      .example('labtunnel 80 --host 192.168.1.50', 'Forward to a different local IP')
      .help()
      .argv;

    if (!argv.port) {
        console.error('❌ Error: You must specify a port. Example: labtunnel 3000');
        process.exit(1);
    }

    if (argv.tcp && argv.udp) {
        console.error('❌ Error: Cannot use both --tcp and --udp. Choose one.');
        process.exit(1);
    }

    let protocol = 'http';
    if (argv.tcp) protocol = 'tcp';
    if (argv.udp) protocol = 'udp';

    createTunnel({
        port: argv.port,
        subdomain: argv.s,
        host: argv.host,
        protocol: protocol,
        server: argv.server || 'wss://tunnel.labcore.es'
    }).catch(err => {
        console.error(`❌ Startup Error: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { createTunnel };
