// 타입을 동봉하지 않는 markdown-it 플러그인용 앰비언트 선언(md-reader에서 수확).
// 와일드카드는 실제 타입(markdown-it-anchor 등)이 있으면 그쪽이 우선하며,
// 타입이 없는 플러그인만 폴백한다. (markdown-it 본체는 `-` 미포함이라 매칭 안 됨)
declare module "markdown-it-*" {
  // md.use(plugin) 에 넘겨야 하므로 호출 가능한 any 로 둔다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugin: any;
  export default plugin;
}
