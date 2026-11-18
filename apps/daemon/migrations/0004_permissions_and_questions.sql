ALTER TABLE `approval` ADD `response_json` text;--> statement-breakpoint
ALTER TABLE `task` ADD `dangerously_skip_permissions` integer DEFAULT false NOT NULL;