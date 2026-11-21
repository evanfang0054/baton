ALTER TABLE `session` ADD `cost_usd` real;--> statement-breakpoint
ALTER TABLE `session` ADD `turns` integer;--> statement-breakpoint
ALTER TABLE `task` ADD `enqueued_at` integer;--> statement-breakpoint
UPDATE `task` SET `enqueued_at` = `updated_at` WHERE `status` = 'queued';