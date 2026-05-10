# labcore-tunnel

A high-performance reverse tunnel CLI tool to securely expose your local applications to the internet. Built entirely in Node.js, it supports dynamic subdomains for HTTP, and raw TCP/UDP tunneling for game servers and databases.

## Installation

Install the package globally via npm:

```bash
npm install -g labcore-tunnel
```

## Usage

### Tunneling HTTP (Web Apps, APIs)

Expose a local web server running on port `3000`:
```bash
labtunnel 3000
```

Request a custom subdomain (`https://my-app.tunnel.labcore.es`):
```bash
labtunnel 3000 -s my-app
```

Forward to a specific local IP (e.g. Raspberry Pi on your LAN):
```bash
labtunnel 80 --host 192.168.1.50
```

### Tunneling TCP (Minecraft, MySQL, SSH)

Expose a local TCP server running on port `25565`:
```bash
labtunnel 25565 --tcp
```

With a custom subdomain:
```bash
labtunnel 25565 --tcp -s my-server
```

Forward to a specific local IP (e.g. Server on your LAN):
```bash
labtunnel 25565 --tcp --host 192.168.1.50
```

### Tunneling UDP (Real-time Games, VoIP)

Expose a local UDP server running on port `7777`:
```bash
labtunnel 7777 --udp
```

With a custom subdomain:
```bash
labtunnel 7777 --udp -s my-game
```

Forward to a specific local IP (e.g. Console on your LAN):
```bash
labtunnel 7777 --udp --host 192.168.1.50
```


## Programmatic Usage

You can also use `labcore-tunnel` as an imported module within your own Node.js applications.

**For CommonJS (`require`):**
```javascript
const { createTunnel } = require('labcore-tunnel');
```

**For ES Modules (`import`):**
```javascript
import labcoreTunnel from 'labcore-tunnel';
const { createTunnel } = labcoreTunnel;
```

**Usage:**
```javascript
async function start() {
    const tunnel = await createTunnel({
        port: 3000,
        subdomain: 'my-custom-app', // Optional
        protocol: 'http',           // 'http', 'tcp', or 'udp'
        host: 'localhost'           // Optional (defaults to localhost)
    });

    console.log('Tunnel is live at:', tunnel.url);

    // When you want to stop the tunnel:
    // tunnel.close();
}

start();
```

## Features

- Connection multiplexing and robust reconnections.
- Base64 streaming for binary compatibility across platforms.
- Support for complex TCP and UDP routing.
- No registration or auth tokens required.
