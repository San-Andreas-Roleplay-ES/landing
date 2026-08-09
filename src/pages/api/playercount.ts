import type { APIRoute } from 'astro';

const SERVER_IP = "play.sarp.es";
const SERVER_PORT = 7777;

export const GET: APIRoute = async () => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(
      `https://api.sampquery.com/v2/servers/${SERVER_IP}:${SERVER_PORT}`,
      { signal: controller.signal }
    );
    
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error('Query failed');
    }

    const data = await response.json();

    return new Response(JSON.stringify({
      online: true,
      players: data.players?.online ?? data.players ?? 0,
      maxPlayers: data.players?.max ?? data.maxPlayers ?? 500
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      online: false,
      players: 0,
      maxPlayers: 500
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  }
};