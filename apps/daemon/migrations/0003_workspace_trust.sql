ALTER TABLE `workspace` ADD `trusted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace` ADD `project_hooks` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace` ADD `trusted_at` integer;