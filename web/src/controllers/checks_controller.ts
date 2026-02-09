import { Controller } from "@hotwired/stimulus";

export default class ChecksController extends Controller {
  static targets = ["status", "output"];

  declare readonly statusTarget: HTMLElement;
  declare readonly outputTarget: HTMLElement;

  connect() {
    this.refresh();
  }

  async refresh() {
    this.statusTarget.textContent = "loading…";
    this.outputTarget.textContent = "";

    try {
      const res = await fetch("/api/checks");
      const data = await res.json();
      this.statusTarget.textContent = data.status;
      this.statusTarget.className = this.statusClasses(data.status);
      if (data.output) {
        this.outputTarget.textContent = data.output;
      }
      if (data.error) {
        this.outputTarget.textContent = data.error;
      }
    } catch {
      this.statusTarget.textContent = "error";
      this.statusTarget.className = "text-sm font-semibold text-red-500";
    }
  }

  private statusClasses(status: string): string {
    switch (status) {
      case "pass":
        return "text-sm font-semibold text-green-600";
      case "fail":
        return "text-sm font-semibold text-red-500";
      default:
        return "text-sm font-semibold text-gray-500";
    }
  }
}
