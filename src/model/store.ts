// Projektliste – entspricht Model/ProjectStore.swift (JSON in IndexedDB statt Dateien).
import { signal } from '@preact/signals';
import { dbAll, dbDelete, dbPut } from './db';
import { clone, uid, type Project } from './project';

export const projects = signal<Project[]>([]);

const sortList = (l: Project[]) => [...l].sort((a, b) => b.modified - a.modified);

export async function loadProjects() {
  projects.value = sortList(await dbAll<Project>('projects'));
}

export async function saveProject(p: Project) {
  const copy = { ...clone(p), modified: Date.now() };
  await dbPut('projects', copy.id, copy);
  const rest = projects.value.filter((x) => x.id !== copy.id);
  projects.value = sortList([copy, ...rest]);
}

export async function deleteProject(id: string) {
  await dbDelete('projects', id);
  projects.value = projects.value.filter((p) => p.id !== id);
}

export async function duplicateProject(p: Project) {
  const copy = { ...clone(p), id: uid(), title: p.title + ' Kopie', created: Date.now() };
  await saveProject(copy);
}
