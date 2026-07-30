import { invoke } from "./invoke";

/** One container row. Mirrors Rust `docker::DockerContainer`. */
export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  running: boolean;
};

/** Is docker usable (installed + daemon up)? Lets the panel show an empty list vs. hide entirely. */
export const dockerOk = () => invoke<boolean>("docker_ok");
/** All containers (running + stopped). Fail-soft — `[]` on any failure. */
export const dockerContainers = () => invoke<DockerContainer[]>("docker_containers");
export const dockerStart = (id: string) => invoke<void>("docker_start", { id });
export const dockerStop = (id: string) => invoke<void>("docker_stop", { id });
