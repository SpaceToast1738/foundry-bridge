export interface PingResult {
  pong: true;
  timestamp: number;
}

export function handlePing(): PingResult {
  return { pong: true, timestamp: Date.now() };
}
