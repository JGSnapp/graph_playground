import { AgentService } from './modules/agent/agent.service.js';
import { RunLogsService } from './modules/agent/run-logs.service.js';
import { ScreenshotBroker } from './modules/agent/screenshots.js';
import { ToolRegistry } from './modules/agent/tools/index.js';
import { BoardsService } from './modules/boards/boards.service.js';
import { ChatsService } from './modules/chat/chats.service.js';
import { Embedder } from './modules/knowledge/embedder.js';
import { KnowledgeService } from './modules/knowledge/knowledge.service.js';
import { LlmProvider } from './modules/llm/provider.js';
import { SettingsService } from './modules/settings/settings.service.js';
import { SkillsService } from './modules/skills/skills.service.js';

export interface AppContext {
  settings: SettingsService;
  provider: LlmProvider;
  boards: BoardsService;
  chats: ChatsService;
  knowledge: KnowledgeService;
  skills: SkillsService;
  screenshots: ScreenshotBroker;
  runLogs: RunLogsService;
  agent: AgentService;
  flush: () => Promise<void>;
}

export interface ContextOptions {
  dataDir: string;
  fetchImpl?: typeof fetch;
  screenshotTimeoutMs?: number;
}

/** Wires the modules together; tests build their own context over a temp dir. */
export const createContext = ({
  dataDir,
  fetchImpl,
  screenshotTimeoutMs,
}: ContextOptions): AppContext => {
  const settings = new SettingsService(dataDir);
  const provider = new LlmProvider(settings, fetchImpl);
  const boards = new BoardsService(dataDir, () => settings.get().provider.defaultModel);
  const chats = new ChatsService(dataDir);
  const embedder = new Embedder(provider, settings);
  const knowledge = new KnowledgeService(dataDir, embedder);
  const skills = new SkillsService(dataDir);
  const screenshots = new ScreenshotBroker(screenshotTimeoutMs);
  const runLogs = new RunLogsService(dataDir);
  const agent = new AgentService(
    boards,
    chats,
    knowledge,
    skills,
    settings,
    provider,
    screenshots,
    runLogs,
    new ToolRegistry(),
  );

  return {
    settings,
    provider,
    boards,
    chats,
    knowledge,
    skills,
    screenshots,
    runLogs,
    agent,
    flush: async () => {
      await Promise.all([
        settings.flush(),
        boards.flush(),
        chats.flush(),
        knowledge.flush(),
        skills.flush(),
        runLogs.flush(),
      ]);
    },
  };
};
