export const studioOperations = `
  return {
    async loomicSnapshot(compositionId) {
      const project = getProject();
      const compositionFile = getCompositionFile({compositionId, project});
      if (!compositionFile) throw new Error('请选择当前合成。');
      return {...inspectComposition(project, compositionFile, compositionId), revision: await projectFingerprint(project, compositionId), compositionId, editReceipt: await inspectEditReceipt(project, compositionId)};
    },
    async loomicApplyEdit(edit) {
      const original = getProject();
      const compositionFile = getCompositionFile({compositionId: edit.compositionId, project: original});
      if (!compositionFile) throw new Error('当前合成已不存在。');
      const next = await prepareStudioEdit(original, compositionFile, edit);
      if (next === original) return;
      if (getProject() !== original) throw new Error('合成已改变，请重新生成计划。');
      controller.applyMutation({fileName: compositionFile, mutate: () => next, nodePathMutationFiles: null, timelineSelection: null, undoRedoNavigation: null});
    },
    async loomicUndoAction(input) {
      const original = getProject();
      const compositionFile = getCompositionFile({compositionId: input.compositionId, project: original});
      if (!compositionFile) throw new Error('当前合成已不存在。');
      const next = await prepareStudioUndo(original, compositionFile, input);
      if (next === original) return;
      if (getProject() !== original) throw new Error('合成已改变，请重新核对撤销动作。');
      controller.applyMutation({fileName: compositionFile, mutate: () => next, nodePathMutationFiles: null, timelineSelection: null, undoRedoNavigation: null});
    },
    addComposition,`;
