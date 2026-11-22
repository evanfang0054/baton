UPDATE `task` SET `engine` = 'claude-sdk', `updated_at` = CAST(strftime('%s','now') AS integer) * 1000 WHERE `engine` = 'fake';--> statement-breakpoint
UPDATE `session` SET `adapter` = 'claude-sdk' WHERE `adapter` = 'fake';--> statement-breakpoint
UPDATE `node` SET `data_json` = replace(`data_json`, '"engine":"fake"', '"engine":"claude-sdk"') WHERE `data_json` LIKE '%"engine":"fake"%';--> statement-breakpoint
UPDATE `supervisor_message` SET `tool_calls_json` = replace(`tool_calls_json`, '"engine":"fake"', '"engine":"claude-sdk"') WHERE `tool_calls_json` LIKE '%"engine":"fake"%';--> statement-breakpoint
UPDATE `supervisor_action` SET `payload_json` = replace(`payload_json`, '"engine":"fake"', '"engine":"claude-sdk"') WHERE `payload_json` LIKE '%"engine":"fake"%';--> statement-breakpoint
UPDATE `supervisor_action` SET `result_json` = replace(`result_json`, '"engine":"fake"', '"engine":"claude-sdk"') WHERE `result_json` LIKE '%"engine":"fake"%';--> statement-breakpoint
UPDATE `supervisor_decision` SET `tool_calls_json` = replace(`tool_calls_json`, '"engine":"fake"', '"engine":"claude-sdk"') WHERE `tool_calls_json` LIKE '%"engine":"fake"%';--> statement-breakpoint
UPDATE `event` SET `payload_json` = replace(`payload_json`, '"engine":"fake"', '"engine":"claude-sdk"') WHERE `payload_json` LIKE '%"engine":"fake"%';--> statement-breakpoint
UPDATE `ws_event` SET `payload_json` = replace(`payload_json`, '"engine":"fake"', '"engine":"claude-sdk"') WHERE `payload_json` LIKE '%"engine":"fake"%';--> statement-breakpoint
UPDATE `audit` SET `detail_json` = replace(`detail_json`, '"engine":"fake"', '"engine":"claude-sdk"') WHERE `detail_json` LIKE '%"engine":"fake"%';--> statement-breakpoint
UPDATE `notice` SET `payload_json` = replace(`payload_json`, '"engine":"fake"', '"engine":"claude-sdk"') WHERE `payload_json` LIKE '%"engine":"fake"%';
