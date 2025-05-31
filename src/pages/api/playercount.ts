import type { APIRoute } from 'astro';

const SERVER_IP = "135.148.128.74:7777";

export const GET: APIRoute = async () => {
  try {
    const response = await fetch('https://api.open.mp/servers');
    const servers = await response.json();

    const server = servers.find((s: any) => s.ip === SERVER_IP);

    if (!server) {
      return new Response(JSON.stringify({ error: 'Server not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      players: server.pc,
      maxPlayers: server.pm
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch server info' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
} 