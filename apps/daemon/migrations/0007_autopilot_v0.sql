CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `notice` ADD `workspace_id` text REFERENCES workspace(id);--> statement-breakpoint
CREATE INDEX `notice_workspace_ts_idx` ON `notice` (`workspace_id`,`ts`);--> statement-breakpoint
CREATE INDEX `audit_action_ts_idx` ON `audit` (`action`,`ts`);--> statement-breakpoint
CREATE INDEX `review_task_idx` ON `review` (`task_id`);--> statement-breakpoint
CREATE INDEX `session_task_idx` ON `session` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_workspace_idx` ON `task` (`workspace_id`);