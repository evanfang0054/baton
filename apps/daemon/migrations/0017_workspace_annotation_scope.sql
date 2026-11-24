PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_annotation` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`delivery_id` text,
	`stage_key` text,
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
INSERT INTO `__new_annotation`("id", "workspace_id", "delivery_id", "stage_key", "target_node_ids_json", "target_artifact_id", "note", "strokes_json", "bbox_json", "image_path", "status", "task_id", "created_at", "updated_at", "resolved_at") SELECT "id", "workspace_id", "delivery_id", "stage_key", "target_node_ids_json", "target_artifact_id", "note", "strokes_json", "bbox_json", "image_path", "status", "task_id", "created_at", "updated_at", "resolved_at" FROM `annotation`;--> statement-breakpoint
DROP TABLE `annotation`;--> statement-breakpoint
ALTER TABLE `__new_annotation` RENAME TO `annotation`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `annotation_delivery_idx` ON `annotation` (`delivery_id`,`stage_key`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `annotation_workspace_idx` ON `annotation` (`workspace_id`,`delivery_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `annotation_task_idx` ON `annotation` (`task_id`);