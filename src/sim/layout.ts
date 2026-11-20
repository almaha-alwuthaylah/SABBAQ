// Illustrative airport geometry for "مطار سَبّاق الافتراضي — مبنى الركاب 01".
// Map units: 1 unit = 0.1 m. Canvas 960 x 640 units (96 m x 64 m).
// This is a fictional facility — NOT a real airport and not engineering data.

export type Rect = { x: number; y: number; w: number; h: number };
export type ZoneKind = "gate" | "concourse" | "service";
export type Zone = { id: string; name: string; sub?: string; kind: ZoneKind; rect: Rect; door?: Rect; capacityWeight: number };
export type Exit = { id: string; name: string; rect: Rect; side: "left" | "right" | "bottom"; emergency: boolean; widthM: number };

export type Layout = {
  id: string;
  name: string;
  building: string;
  width: number;
  height: number;
  unitM: number; // metres per unit
  outer: Rect;
  zones: Zone[];
  exits: Exit[];
  mainEntrance: Rect; // corridor stub (not an evacuation exit in the baseline model)
  gates: { id: string; x: number }[];
};

const gateW = 200, gateGap = 20, gx0 = 50;
const gates: Zone[] = [0, 1, 2, 3].map((i) => {
  const x = gx0 + i * (gateW + gateGap);
  return {
    id: `G0${i + 1}`,
    name: `بوابة 0${i + 1}`,
    sub: "صالة الانتظار",
    kind: "gate",
    rect: { x, y: 80, w: gateW, h: 120 },
    door: { x: x + gateW / 2 - 10, y: 198, w: 20, h: 14 },
    capacityWeight: 1.4,
  };
});

const svcNames: [string, string][] = [
  ["SVC", "الخدمات"],
  ["SEC", "تفتيش أمني"],
  ["CHK", "تسجيل الرحلات"],
  ["BAG", "استلام الأمتعة"],
  ["OPS", "إدارة التشغيل"],
];
const sw = 164, sg = 10;
const services: Zone[] = svcNames.map(([id, name], i) => {
  const x = 50 + i * (sw + sg);
  return {
    id,
    name,
    kind: "service",
    rect: { x, y: 330, w: sw, h: 210 },
    door: { x: x + sw / 2 - 10, y: 318, w: 20, h: 14 },
    capacityWeight: id === "OPS" ? 0.4 : 0.8,
  };
});

export const DEFAULT_LAYOUT: Layout = {
  id: "sabbaq-t1",
  name: "مطار سَبّاق الافتراضي",
  building: "مبنى الركاب 01",
  width: 960,
  height: 640,
  unitM: 0.1,
  outer: { x: 40, y: 70, w: 880, h: 480 },
  zones: [
    ...gates,
    { id: "CON", name: "البهو الرئيسي", kind: "concourse", rect: { x: 50, y: 210, w: 860, h: 110 }, capacityWeight: 1.0 },
    ...services,
  ],
  exits: [
    { id: "E1", name: "مخرج E1", rect: { x: 28, y: 253, w: 24, h: 24 }, side: "left", emergency: false, widthM: 2.4 },
    { id: "E2", name: "مخرج E2", rect: { x: 908, y: 253, w: 24, h: 24 }, side: "right", emergency: false, widthM: 2.4 },
    { id: "E3", name: "مخرج طوارئ E3", rect: { x: 296, y: 538, w: 18, h: 22 }, side: "bottom", emergency: true, widthM: 1.8 },
    { id: "E4", name: "مخرج طوارئ E4", rect: { x: 646, y: 538, w: 18, h: 22 }, side: "bottom", emergency: true, widthM: 1.8 },
  ],
  mainEntrance: { x: 468, y: 538, w: 24, h: 40 },
  gates: gates.map((g) => ({ id: g.id.replace("G0", "G"), x: g.rect.x + g.rect.w / 2 })),
};

export const zoneById = (l: Layout, id: string) => l.zones.find((z) => z.id === id);
export const exitById = (l: Layout, id: string) => l.exits.find((e) => e.id === id);
export const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const inRect = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
