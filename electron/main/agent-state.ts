import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  AiAgentState,
  AiChatMessage,
  AiChatThread,
  AiGoal,
  AiPermissionGrant,
  AiPermissionKind,
  AiPermissionScope,
  AiQueueItem,
  AiSchedule,
} from "../types.js";

const permissionKinds = new Set<AiPermissionKind>([
  "project.read",
  "project.write",
  "terminal.run",
  "debug.run",
  "web.search",
  "browser.control",
  "computer.control",
  "platformio.run",
]);
const permissionScopes = new Set<AiPermissionScope>([
  "once",
  "conversation",
  "always",
]);

const emptyState = (): AiAgentState => ({
  chats: [],
  goals: [],
  queue: [],
  schedules: [],
  permissions: [],
});

function text(value: unknown, max = 20_000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function attachments(
  value: unknown,
): NonNullable<AiChatMessage["attachments"]> {
  if (!Array.isArray(value)) return [];
  const allowed = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ]);
  let total = 0;
  return value.slice(0, 6).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const input = item as Record<string, unknown>;
    const mimeType = text(input.mimeType, 40);
    const dataUrl = text(input.dataUrl, 7_000_000);
    if (
      !allowed.has(mimeType) ||
      !dataUrl.startsWith(`data:${mimeType};base64,`) ||
      dataUrl.length > 7_000_000 ||
      total + dataUrl.length > 18_000_000
    )
      return [];
    total += dataUrl.length;
    return [
      {
        id: text(input.id, 100) || crypto.randomUUID(),
        name: text(input.name, 240) || "Image",
        mimeType: mimeType as
          "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        dataUrl,
      },
    ];
  });
}

function messages(value: unknown): AiChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-200).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const input = item as Partial<AiChatMessage>;
    if (input.role !== "user" && input.role !== "assistant") return [];
    const content = text(input.content, 200_000);
    const savedAttachments = attachments(input.attachments);
    if (!content.trim() && !savedAttachments.length) return [];
    return [
      {
        id: text(input.id, 100) || crypto.randomUUID(),
        role: input.role,
        content,
        thinking: text(input.thinking, 40_000) || undefined,
        createdAt: text(input.createdAt, 40) || new Date().toISOString(),
        assistantName:
          input.assistantName === "Custom Model"
            ? "Custom Model"
            : input.role === "assistant"
              ? "osCode"
              : undefined,
        attachments: savedAttachments,
      },
    ];
  });
}

export class AgentStateStore {
  private mutation = Promise.resolve();

  constructor(private readonly userData: string) {}

  private get statePath() {
    return path.join(this.userData, "ai", "agent-state.json");
  }

  private async read(): Promise<AiAgentState> {
    try {
      const value = JSON.parse(await fs.readFile(this.statePath, "utf8")) as
        Partial<AiAgentState> | undefined;
      if (!value || typeof value !== "object") return emptyState();
      return {
        chats: Array.isArray(value.chats)
          ? value.chats.slice(-100).flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const input = item as Partial<AiChatThread>;
              const id = text(input.id, 100);
              const projectRoot = text(input.projectRoot, 2000);
              if (!id || !projectRoot) return [];
              const now = new Date().toISOString();
              return [
                {
                  id,
                  title: text(input.title, 120) || "New chat",
                  projectRoot,
                  messages: messages(input.messages),
                  contextSummary: text(input.contextSummary, 64_000),
                  createdAt: text(input.createdAt, 40) || now,
                  updatedAt: text(input.updatedAt, 40) || now,
                },
              ];
            })
          : [],
        goals: Array.isArray(value.goals)
          ? (value.goals as AiGoal[]).slice(-200)
          : [],
        queue: Array.isArray(value.queue)
          ? (value.queue as AiQueueItem[]).slice(-500)
          : [],
        schedules: Array.isArray(value.schedules)
          ? (value.schedules as AiSchedule[]).slice(-200)
          : [],
        permissions: Array.isArray(value.permissions)
          ? value.permissions
              .slice(-500)
              .filter((grant): grant is AiPermissionGrant =>
                Boolean(
                  grant &&
                  typeof grant.id === "string" &&
                  permissionKinds.has(grant.kind as AiPermissionKind) &&
                  permissionScopes.has(grant.scope as AiPermissionScope),
                ),
              )
          : [],
      };
    } catch {
      return emptyState();
    }
  }

  private async write(state: AiAgentState) {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(temporary, this.statePath);
  }

  private async update<T>(change: (state: AiAgentState) => T | Promise<T>) {
    let result!: T;
    this.mutation = this.mutation.then(async () => {
      const state = await this.read();
      result = await change(state);
      await this.write(state);
    });
    await this.mutation;
    return result;
  }

  state(projectRoot: string) {
    return this.read().then((state) => ({
      chats: state.chats.filter((item) => item.projectRoot === projectRoot),
      goals: state.goals.filter((item) =>
        state.chats.some(
          (chat) => chat.id === item.chatId && chat.projectRoot === projectRoot,
        ),
      ),
      queue: state.queue.filter((item) =>
        state.chats.some(
          (chat) => chat.id === item.chatId && chat.projectRoot === projectRoot,
        ),
      ),
      schedules: state.schedules.filter((item) =>
        state.chats.some(
          (chat) => chat.id === item.chatId && chat.projectRoot === projectRoot,
        ),
      ),
      permissions: state.permissions.filter(
        (item) => item.projectRoot === projectRoot,
      ),
    }));
  }

  createChat(projectRoot: string, title = "New chat") {
    return this.update((state) => {
      const now = new Date().toISOString();
      const chat: AiChatThread = {
        id: crypto.randomUUID(),
        title: text(title, 120) || "New chat",
        projectRoot,
        messages: [],
        contextSummary: "",
        createdAt: now,
        updatedAt: now,
      };
      state.chats.push(chat);
      return chat;
    });
  }

  saveChat(
    id: string,
    projectRoot: string,
    chatMessages: AiChatMessage[],
    contextSummary: string,
  ) {
    return this.update((state) => {
      const chat = state.chats.find(
        (item) => item.id === id && item.projectRoot === projectRoot,
      );
      if (!chat) throw new Error("Chat was not found");
      chat.messages = messages(chatMessages);
      chat.contextSummary = text(contextSummary, 64_000);
      chat.updatedAt = new Date().toISOString();
      const first = chat.messages.find((item) => item.role === "user");
      if (first && chat.title === "New chat")
        chat.title = first.content.replace(/\s+/g, " ").slice(0, 60);
      return chat;
    });
  }

  deleteChat(id: string, projectRoot: string) {
    return this.update((state) => {
      const exists = state.chats.some(
        (item) => item.id === id && item.projectRoot === projectRoot,
      );
      if (!exists) return false;
      state.chats = state.chats.filter((item) => item.id !== id);
      state.goals = state.goals.filter((item) => item.chatId !== id);
      state.queue = state.queue.filter((item) => item.chatId !== id);
      state.schedules = state.schedules.filter((item) => item.chatId !== id);
      state.permissions = state.permissions.filter(
        (item) => item.chatId !== id || item.scope === "always",
      );
      return true;
    });
  }

  setGoal(chatId: string, goalText: string, automatic: boolean) {
    return this.update((state) => {
      if (!state.chats.some((item) => item.id === chatId))
        throw new Error("Chat was not found");
      state.goals = state.goals.filter(
        (item) => item.chatId !== chatId || item.status === "complete",
      );
      const goal: AiGoal = {
        id: crypto.randomUUID(),
        chatId,
        text: text(goalText, 1000).trim(),
        status: "active",
        automatic,
        createdAt: new Date().toISOString(),
      };
      state.goals.push(goal);
      return goal;
    });
  }

  completeGoal(id: string) {
    return this.update((state) => {
      const goal = state.goals.find((item) => item.id === id);
      if (!goal) return false;
      goal.status = "complete";
      return true;
    });
  }

  removeGoal(id: string) {
    return this.update((state) => {
      const length = state.goals.length;
      state.goals = state.goals.filter((item) => item.id !== id);
      return state.goals.length !== length;
    });
  }

  addQueue(chatId: string, prompt: string, runAt?: string, automatic = false) {
    return this.update((state) => {
      if (!state.chats.some((item) => item.id === chatId))
        throw new Error("Chat was not found");
      const item: AiQueueItem = {
        id: crypto.randomUUID(),
        chatId,
        prompt: text(prompt).trim(),
        status: "queued",
        createdAt: new Date().toISOString(),
        ...(runAt ? { runAt } : {}),
        automatic,
      };
      state.queue.push(item);
      return item;
    });
  }

  updateQueue(id: string, status: AiQueueItem["status"]) {
    return this.update((state) => {
      const item = state.queue.find((entry) => entry.id === id);
      if (!item) return false;
      item.status = status;
      return true;
    });
  }

  prioritizeQueue(id: string) {
    return this.update((state) => {
      const index = state.queue.findIndex(
        (item) => item.id === id && item.status === "queued",
      );
      if (index < 0) return false;
      const [item] = state.queue.splice(index, 1);
      state.queue.unshift(item);
      return true;
    });
  }

  removeQueue(id: string) {
    return this.update((state) => {
      const length = state.queue.length;
      state.queue = state.queue.filter((item) => item.id !== id);
      return state.queue.length !== length;
    });
  }

  addSchedule(
    chatId: string,
    prompt: string,
    nextRunAt: string,
    cadence: AiSchedule["cadence"],
    automatic = false,
  ) {
    return this.update((state) => {
      if (!state.chats.some((item) => item.id === chatId))
        throw new Error("Chat was not found");
      const when = new Date(nextRunAt);
      if (!Number.isFinite(when.getTime()))
        throw new Error("Choose a date and time");
      const schedule: AiSchedule = {
        id: crypto.randomUUID(),
        chatId,
        prompt: text(prompt).trim(),
        cadence: ["once", "daily", "weekly"].includes(cadence)
          ? cadence
          : "once",
        nextRunAt: when.toISOString(),
        enabled: true,
        createdAt: new Date().toISOString(),
        automatic,
      };
      state.schedules.push(schedule);
      return schedule;
    });
  }

  removeSchedule(id: string) {
    return this.update((state) => {
      const length = state.schedules.length;
      state.schedules = state.schedules.filter((item) => item.id !== id);
      return length !== state.schedules.length;
    });
  }

  async collectDue(projectRoot: string) {
    return this.update((state) => {
      const now = Date.now();
      const projectChats = new Set(
        state.chats
          .filter((chat) => chat.projectRoot === projectRoot)
          .map((chat) => chat.id),
      );
      const due = state.schedules.filter(
        (item) =>
          item.enabled &&
          projectChats.has(item.chatId) &&
          new Date(item.nextRunAt).getTime() <= now,
      );
      for (const schedule of due) {
        state.queue.push({
          id: crypto.randomUUID(),
          chatId: schedule.chatId,
          prompt: schedule.prompt,
          status: "queued",
          createdAt: new Date().toISOString(),
          runAt: schedule.nextRunAt,
          automatic: true,
        });
        if (schedule.cadence === "once") schedule.enabled = false;
        else {
          const next = new Date(schedule.nextRunAt);
          next.setDate(next.getDate() + (schedule.cadence === "daily" ? 1 : 7));
          while (next.getTime() <= now)
            next.setDate(
              next.getDate() + (schedule.cadence === "daily" ? 1 : 7),
            );
          schedule.nextRunAt = next.toISOString();
        }
      }
      return due.length;
    });
  }

  grantPermission(
    kind: AiPermissionKind,
    scope: AiPermissionScope,
    chatId: string,
    projectRoot: string,
    detail: string,
  ) {
    if (!permissionKinds.has(kind) || !permissionScopes.has(scope))
      throw new Error("Choose a valid permission");
    return this.update((state) => {
      const grant: AiPermissionGrant = {
        id: crypto.randomUUID(),
        kind,
        scope,
        chatId: scope === "always" ? "*" : chatId,
        projectRoot,
        createdAt: new Date().toISOString(),
        detail: text(detail, 500),
      };
      state.permissions = state.permissions.filter(
        (item) =>
          !(
            item.kind === grant.kind &&
            item.scope === grant.scope &&
            item.chatId === grant.chatId &&
            item.projectRoot === grant.projectRoot
          ),
      );
      state.permissions.push(grant);
      return grant;
    });
  }

  revokePermission(id: string) {
    return this.update((state) => {
      const length = state.permissions.length;
      state.permissions = state.permissions.filter((item) => item.id !== id);
      return state.permissions.length !== length;
    });
  }

  async usePermission(
    kind: AiPermissionKind,
    chatId: string,
    projectRoot: string,
  ) {
    let allowed = false;
    await this.update((state) => {
      const grant = state.permissions
        .slice()
        .reverse()
        .find(
          (item) =>
            item.kind === kind &&
            item.projectRoot === projectRoot &&
            (item.scope === "always" || item.chatId === chatId),
        );
      if (!grant) return;
      allowed = true;
      if (grant.scope === "once")
        state.permissions = state.permissions.filter(
          (item) => item.id !== grant.id,
        );
    });
    return allowed;
  }
}
