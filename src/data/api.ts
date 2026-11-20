// Frontend-only mock data layer. Everything lives in local state (persisted to localStorage when
// available) and is seeded with sample results produced by the real simulation engine at build time.
// Authentication is a demo flow: no credentials are checked or stored.
import { Api, ApiError, Project, Report, Run, User } from "./types";
import seed from "./seed.json";
import { DEFAULT_CONFIG } from "../sim/engine";
import { DEFAULT_LAYOUT } from "../sim/layout";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const now = () => new Date().toISOString();
const ago = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
const KEY = "sabbaq.demo.v1";

type DB = { user: User | null; projects: Project[]; runs: Run[]; reports: Report[] };

function seedDb(user: User): Omit<DB, "user"> {
  const mk = (id: string, name: string, description: string, facility: Project["facility"], days: number, cfg = {}): Project => ({
    id, ownerId: user.id, name, description, facility, source: "builtin", layout: DEFAULT_LAYOUT,
    config: { ...DEFAULT_CONFIG, hazard: { type: "fire", zoneId: "G03", at: 30 }, ...cfg }, status: "ready", createdAt: ago(days + 10), updatedAt: ago(days),
  });
  const projects = [
    mk("p1", "مطار سَبّاق الافتراضي", "مبنى ركاب خيالي بأربع بوابات وبهو رئيسي وخمس مناطق خدمة.", "terminal", 1, { passengers: 800, exits: 2, emergencyExits: 0, hazard: { type: "fire", zoneId: "G04", at: 30 } }),
    mk("p2", "صالة التدريب الشمالية", "بيئة تدريبية لتمارين الإخلاء الدورية.", "training", 5, { passengers: 600, hazard: { type: "gas", zoneId: "CON", at: 25 } }),
    mk("p3", "مبنى الركاب التجريبي", "اختبار تدفّق ركاب كثيف عبر نقاط التفتيش.", "hall", 6, { passengers: 900, distribution: "concourse", hazard: { type: "crowd", zoneId: "SEC", at: 15 } }),
  ];
  const runs: Run[] = (seed.runs as any[]).map(({ daysAgo, ...r }) => ({ ...r, ownerId: user.id, createdAt: ago(daysAgo) }));
  const reports: Report[] = [{
    id: "rep1", ownerId: user.id, projectId: "p1", title: "ملف قرار السلامة — حريق البوابة 03", runIds: ["r1", "r3", "r4"],
    decision: "approve-with-changes", notes: "اعتماد إعادة توزيع المسافرين كإجراء تشغيلي، مع دراسة هندسية لمسار الطوارئ E04.", createdAt: ago(1),
  }];
  return { projects, runs, reports };
}

class MockApi implements Api {
  readonly mode = "browser" as const;
  private db: DB;
  constructor() {
    let db: DB = { user: null, projects: [], runs: [], reports: [] };
    try { const raw = localStorage.getItem(KEY); if (raw) db = JSON.parse(raw); } catch { /* storage unavailable */ }
    this.db = db;
  }
  private save() { try { localStorage.setItem(KEY, JSON.stringify(this.db)); } catch { /* ignore */ } }
  private wait<T>(v: T, ms = 160) { return new Promise<T>((r) => setTimeout(() => r(v), ms)); }
  private u() { if (!this.db.user) throw new ApiError("unauthorized", "يلزم تسجيل الدخول", 401); return this.db.user; }
  private signIn(name: string, email: string) {
    const fresh = !this.db.user || this.db.user.email !== email;
    const user: User = fresh ? { id: "demo", name, email, org: "إدارة السلامة — بيئة تجريبية", role: "محلل سلامة", createdAt: now() } : this.db.user!;
    this.db = { user, ...(fresh || !this.db.projects.length ? seedDb(user) : { projects: this.db.projects, runs: this.db.runs, reports: this.db.reports }) };
    this.save();
    return this.wait(user, 450);
  }

  async me() { return this.db.user; }
  login(email: string, _password: string) { return this.signIn(this.db.user?.email === email ? this.db.user.name : "سارة", email.trim().toLowerCase()); }
  register(name: string, email: string, _password: string) { return this.signIn(name.trim(), email.trim().toLowerCase()); }
  async logout() { this.db.user = null; this.save(); }
  async requestReset() { await this.wait(null, 500); }
  async updateProfile(patch: Partial<User>) { Object.assign(this.u(), patch); this.save(); return this.wait({ ...this.u() }); }
  async changePassword() { await this.wait(null, 400); }
  async deleteAccount() { this.db = { user: null, projects: [], runs: [], reports: [] }; this.save(); }

  async listProjects() { this.u(); return this.wait([...this.db.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); }
  async getProject(id: string) { const p = this.db.projects.find((x) => x.id === id); if (!p) throw new ApiError("not_found", "المشروع غير موجود", 404); return this.wait(p); }
  async createProject(p: Omit<Project, "id" | "ownerId" | "createdAt" | "updatedAt">) {
    const np: Project = { ...p, id: uid(), ownerId: this.u().id, createdAt: now(), updatedAt: now() };
    this.db.projects.push(np); this.save(); return this.wait(np);
  }
  async updateProject(id: string, patch: Partial<Project>) {
    const p = await this.getProject(id);
    Object.assign(p, patch, { id: p.id, updatedAt: now() }); this.save(); return { ...p };
  }
  async deleteProject(id: string) {
    this.db.projects = this.db.projects.filter((x) => x.id !== id);
    this.db.runs = this.db.runs.filter((x) => x.projectId !== id);
    this.db.reports = this.db.reports.filter((x) => x.projectId !== id);
    this.save();
  }
  async listRuns(projectId?: string) { this.u(); return this.wait(this.db.runs.filter((r) => !projectId || r.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))); }
  async createRun(r: Omit<Run, "id" | "ownerId" | "createdAt">) { const nr: Run = { ...r, id: uid(), ownerId: this.u().id, createdAt: now() }; this.db.runs.push(nr); this.save(); return nr; }
  async deleteRun(id: string) { this.db.runs = this.db.runs.filter((x) => x.id !== id); this.save(); }
  async listReports() { this.u(); return this.wait([...this.db.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt))); }
  async createReport(r: Omit<Report, "id" | "ownerId" | "createdAt">) { const nr: Report = { ...r, id: uid(), ownerId: this.u().id, createdAt: now() }; this.db.reports.push(nr); this.save(); return nr; }
  async deleteReport(id: string) { this.db.reports = this.db.reports.filter((x) => x.id !== id); this.save(); }
}

export const api: Api = new MockApi();
