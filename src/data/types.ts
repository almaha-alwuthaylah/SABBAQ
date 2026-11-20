import type { Layout } from "../sim/layout";
import type { SimConfig, SimSummary } from "../sim/engine";

export type User = { id: string; name: string; email: string; org?: string; role?: string; createdAt: string };
export type FacilityType = "terminal" | "training" | "hall";
export type Project = {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  facility: FacilityType;
  source: "builtin" | "traced";
  layout: Layout;
  config: SimConfig;
  planImage?: string; // data URL of the uploaded plan (traced projects)
  status: "ready" | "draft";
  createdAt: string;
  updatedAt: string;
};
export type RunKind = "simulation" | "improvement" | "stress" | "challenge" | "duel" | "robustness";
export type Run = {
  id: string;
  ownerId: string;
  projectId: string;
  kind: RunKind;
  title: string;
  config: SimConfig;
  summary: SimSummary;
  score: number;
  meta?: Record<string, unknown>;
  createdAt: string;
};
export type Report = {
  id: string;
  ownerId: string;
  projectId: string;
  title: string;
  runIds: string[];
  decision: string;
  notes?: string;
  createdAt: string;
};

export interface Api {
  readonly mode: "browser";
  me(): Promise<User | null>;
  login(email: string, password: string): Promise<User>;
  register(name: string, email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  requestReset(email: string): Promise<void>;
  updateProfile(patch: Partial<Pick<User, "name" | "org" | "role">>): Promise<User>;
  changePassword(current: string, next: string): Promise<void>;
  deleteAccount(): Promise<void>;

  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project>;
  createProject(p: Omit<Project, "id" | "ownerId" | "createdAt" | "updatedAt">): Promise<Project>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  listRuns(projectId?: string): Promise<Run[]>;
  createRun(r: Omit<Run, "id" | "ownerId" | "createdAt">): Promise<Run>;
  deleteRun(id: string): Promise<void>;

  listReports(): Promise<Report[]>;
  createReport(r: Omit<Report, "id" | "ownerId" | "createdAt">): Promise<Report>;
  deleteReport(id: string): Promise<void>;
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
