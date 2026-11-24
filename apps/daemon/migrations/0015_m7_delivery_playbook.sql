CREATE TABLE `annotation` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`stage_key` text NOT NULL,
	`target_node_ids_json` text DEFAULT '[]' NOT NULL,
	`target_artifact_id` text,
	`note` text DEFAULT '' NOT NULL,
	`strokes_json` text NOT NULL,
	`bbox_json` text NOT NULL,
	`image_path` text NOT NULL,
	`status` text NOT NULL,
	`task_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`delivery_id`) REFERENCES `delivery`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_artifact_id`) REFERENCES `artifact`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `annotation_delivery_idx` ON `annotation` (`delivery_id`,`stage_key`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `annotation_task_idx` ON `annotation` (`task_id`);--> statement-breakpoint
CREATE TABLE `artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`stage_key` text NOT NULL,
	`task_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`source_path` text,
	`svg_path` text,
	`mime` text,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`delivery_id`) REFERENCES `delivery`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_name_idx` ON `artifact` (`delivery_id`,`stage_key`,`name`);--> statement-breakpoint
CREATE INDEX `artifact_delivery_idx` ON `artifact` (`delivery_id`,`stage_key`,`created_at`);--> statement-breakpoint
CREATE TABLE `delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`canvas_id` text NOT NULL,
	`title` text NOT NULL,
	`goal` text NOT NULL,
	`playbook_id` text NOT NULL,
	`playbook_version` integer NOT NULL,
	`playbook_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`cancelled_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_canvas_idx` ON `delivery` (`canvas_id`);--> statement-breakpoint
CREATE INDEX `delivery_workspace_idx` ON `delivery` (`workspace_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `canvas` ADD `delivery_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `canvas_delivery_idx` ON `canvas` (`delivery_id`);--> statement-breakpoint
ALTER TABLE `task` ADD `delivery_id` text;--> statement-breakpoint
ALTER TABLE `task` ADD `stage_key` text;--> statement-breakpoint
ALTER TABLE `task` ADD `annotation_ids_json` text;--> statement-breakpoint
CREATE INDEX `task_delivery_idx` ON `task` (`delivery_id`,`stage_key`);