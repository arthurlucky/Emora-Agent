import { SearchWebTool } from "../tools/search_web.js";

import { listFilesTool } from "../tools/list_file.js";
import { readFileTool } from "../tools/read_file.js";
import { writeFileTool } from "../tools/write_file.js";
import { datetimeTool } from "../tools/datetime.js";
import { shellExecTool } from "../tools/shell_exec.js";
import projectManagerTool from "../tools/project_manager.js";
import { schedulerTool } from "../tools/scheduler.js";
import { FetchPageTool }from "../tools/fetch_page.js";

import groupManagerTool from "../tools/group_manager.js";

import searchTextTool from "../tools/search_text.js";
import emoraHubTool from "../tools/emora_hub.js";

import findFolderTool from "../tools/find_folder.js";

import createFolderTool from "../tools/create_folder.js";
import deleteFolderTool from "../tools/delete_folder.js";

import zipCompressTool from "../tools/zip_compress.js";
import zipExtractTool from "../tools/zip_extract.js";

import { skillFactoryTool } from "../tools/skill_factory.js";
import backupManager from "../tools/backup_manager.js";
import { systemMonitorTool } from "../tools/system_monitor.js";
import { economyManagerTool } from "../tools/economy_manager.js";
import { gitManagerTool } from "../tools/git_manager.js";

const tools = [
  SearchWebTool,
  FetchPageTool,

  listFilesTool,
  readFileTool,
  writeFileTool,

  searchTextTool,
  findFolderTool,

  createFolderTool,
  deleteFolderTool,

  zipCompressTool,
  zipExtractTool,
  
  datetimeTool,
  shellExecTool,
  projectManagerTool,
  schedulerTool,

  skillFactoryTool,
  backupManager,
  systemMonitorTool,
  emoraHubTool,
  economyManagerTool,
  gitManagerTool,
  
  groupManagerTool
];

export default tools;
