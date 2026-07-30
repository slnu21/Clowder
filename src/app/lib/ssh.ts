import { invoke } from "./invoke";

/** One `Host` entry from `~/.ssh/config`. Mirrors Rust `ssh::SshHost` (camelCase). */
export type SshHost = {
  host: string;
  hostName: string | null;
  user: string | null;
  port: number | null;
};

/** Concrete hosts from `~/.ssh/config`. Fail-soft in Rust — resolves to `[]` if the file is absent. */
export const sshHosts = () => invoke<SshHost[]>("ssh_hosts");
