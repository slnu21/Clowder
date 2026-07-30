import { invoke } from "./invoke";

/** One listening TCP port and the process that owns it. Mirrors Rust `ports::PortRow`. `system` marks
 *  an OS/service-owned port (svchost, System, …), hidden by default in the panel. */
export type PortRow = { port: number; pid: number; process: string; addr: string; system: boolean };

/** Listening TCP ports (IPv4), sorted by port. Fail-soft in Rust — resolves to `[]` on any failure. */
export const listPorts = () => invoke<PortRow[]>("list_ports");

/** Terminate a process by pid. Rejects with a message string on failure (shown inline on the row). */
export const killProcess = (pid: number) => invoke<void>("kill_process", { pid });
