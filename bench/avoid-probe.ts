/** What does libavoid-js actually expose, and how is a route read back? */
import { AvoidLib } from 'libavoid-js';

const main = async () => {
  await AvoidLib.load();
  const Avoid: any = AvoidLib.getInstance();
  console.log('экспорты:', Object.keys(Avoid).sort().join(', '));

  for (const name of ['RoutingOption', 'RoutingParameter', 'ConnDirFlag', 'ConnType']) {
    const value = Avoid[name];
    if (!value) continue;
    const members = Object.keys(value).filter((k) => k !== 'prototype');
    console.log(`\n${name}: ${members.join(', ') || '(нет статических полей)'}`);
  }

  console.log('RouterFlag:', Object.keys(Avoid.RouterFlag ?? {}).filter((k) => k !== 'values' && k !== 'C').join(', '));

  // Smallest possible routing: two boxes, one connector, ends pinned to the
  // shapes so libavoid picks where to attach.
  const router = new Avoid.Router(Avoid.RouterFlag.OrthogonalRouting.value);
  const shape = (x: number, y: number) =>
    new Avoid.ShapeRef(
      router,
      new Avoid.Rectangle(new Avoid.Point(x, y), new Avoid.Point(x + 200, y + 120)),
    );
  const a = shape(0, 0);
  const b = shape(500, 300);

  // classId 1 and 2 identify the pin; 15 is "attach on any side".
  const pinA = new Avoid.ShapeConnectionPin(a, 1, 0.5, 0.5, true, 0, 15);
  const pinB = new Avoid.ShapeConnectionPin(b, 2, 0.5, 0.5, true, 0, 15);
  pinA.setExclusive(false);
  pinB.setExclusive(false);

  const conn = new Avoid.ConnRef(router, new Avoid.ConnEnd(a, 1), new Avoid.ConnEnd(b, 2));
  router.processTransaction();

  const route = conn.displayRoute();
  console.log('трасса: точек', route.size());
  const proto = Object.getPrototypeOf(route);
  console.log("методы трассы:", Object.getOwnPropertyNames(proto).join(", "));
  const ps = (route as any).ps;
  console.log("ps:", typeof ps, ps ? Object.getOwnPropertyNames(Object.getPrototypeOf(ps)).join(", ") : "");
  router.deleteRouter();
};

main().catch((error) => {
  console.error('ошибка:', (error as Error).message);
});
