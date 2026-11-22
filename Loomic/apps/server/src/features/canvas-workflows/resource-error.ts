export class WorkflowResourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowResourceError";
  }
}
