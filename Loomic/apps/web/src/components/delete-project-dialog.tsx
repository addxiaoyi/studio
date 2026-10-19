"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { t, useLocale } from "@/lib/i18n";

interface DeleteProjectDialogProps {
  open: boolean;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteProjectDialog({
  open,
  deleting,
  onConfirm,
  onCancel,
}: DeleteProjectDialogProps) {
  const copy = t(useLocale()).project;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogTitle>{copy.deleteTitle}</DialogTitle>
        <DialogDescription>
          {copy.deleteConfirm}
        </DialogDescription>
        <div className="mt-4 flex items-center justify-end gap-3">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-xl"
          >
            {copy.cancel}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? (
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                className="flex items-center justify-center"
              >
                <Loader2 size={16} />
              </motion.span>
            ) : (
              copy.moveToRecovery
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
