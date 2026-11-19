ALTER TABLE `review` ADD `diff_json` text;--> statement-breakpoint
ALTER TABLE `ws_event` ADD `task_id` text;--> statement-breakpoint
CREATE INDEX `ws_event_task_ordinal_idx` ON `ws_event` (`task_id`,`ordinal`);--> statement-breakpoint
UPDATE `ws_event`
SET `task_id` = CASE
  WHEN json_valid(`payload_json`) THEN json_extract(`payload_json`, '$.payload.taskId')
  ELSE NULL
END
WHERE `type` = 'task.status';