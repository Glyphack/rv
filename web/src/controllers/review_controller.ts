import { Controller } from "@hotwired/stimulus";
import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-slim.js";

enum DiffSide {
  Old = "old",
  New = "new",
}

interface Selection {
  fileName: string;
  startLine: number;
  endLine: number;
  diffSide: DiffSide;
}

interface Comment {
  selection: Selection;
  text: string;
  branch: string;
}

interface DiffResponse {
  branch: string;
  base_branch: string;
  commits: Array<{ hash: string; label: string }>;
  selected_commit: string;
  is_current_branch: boolean;
  diff: string;
  files: string[];
  branches: string[];
  current_branch: string;
}


function flashButton(btn: HTMLButtonElement, message: string, ms: number) {
  const original = btn.textContent;
  btn.textContent = message;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, ms);
}

class CommentStorage {
  private static KEY = "towelie-comments";
  private comments: Comment[] = [];

  load() {
    const stored = localStorage.getItem(CommentStorage.KEY);
    if (stored) {
      try {
        this.comments = JSON.parse(stored);
      } catch {
        this.comments = [];
        localStorage.removeItem(CommentStorage.KEY);
      }
    }
  }

  add(selection: Selection, text: string, branch: string) {
    this.comments.push({ selection, text, branch });
    this.save();
  }

  remove(comment: Comment) {
    const idx = this.comments.indexOf(comment);
    if (idx !== -1) {
      this.comments.splice(idx, 1);
      this.save();
    }
  }

  forBranch(branch: string): Comment[] {
    return this.comments.filter((c) => c.branch === branch);
  }

  clearBranch(branch: string) {
    this.comments = this.comments.filter((c) => c.branch !== branch);
    this.save();
  }

  private save() {
    localStorage.setItem(CommentStorage.KEY, JSON.stringify(this.comments));
  }
}

function populateBranchSelects(
  branchSelect: HTMLSelectElement,
  baseBranchSelect: HTMLSelectElement,
  data: DiffResponse,
) {
  const savedBranch = branchSelect.value;
  const savedBase = baseBranchSelect.value;

  branchSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = `${data.current_branch} (current)`;
  branchSelect.appendChild(defaultOption);
  for (const branch of data.branches) {
    const option = document.createElement("option");
    option.value = branch;
    option.textContent = branch;
    branchSelect.appendChild(option);
  }
  branchSelect.value = savedBranch;

  const baseBranches = data.branches
    .filter((branch) => branch !== data.current_branch)
    .sort((a, b) => a.localeCompare(b));
  baseBranchSelect.innerHTML = "";
  const baseDefault = document.createElement("option");
  baseDefault.value = "";
  baseDefault.textContent = "Default (main/master)";
  baseBranchSelect.appendChild(baseDefault);
  for (const branch of baseBranches) {
    const option = document.createElement("option");
    option.value = branch;
    option.textContent = branch;
    baseBranchSelect.appendChild(option);
  }
  baseBranchSelect.value = savedBase;
}

function populateCommitSelect(
  commitSelect: HTMLSelectElement,
  data: DiffResponse,
) {
  const savedValue = commitSelect.value;
  commitSelect.innerHTML = "";

  for (const commit of data.commits) {
    const option = document.createElement("option");
    option.value = commit.hash;
    option.textContent = commit.label;
    commitSelect.appendChild(option);
  }

  const options = Array.from(commitSelect.options);
  if (options.some((o) => o.value === savedValue)) {
    commitSelect.value = savedValue;
  }
}

function renderTreeLevel(
  parent: HTMLElement,
  tree: Map<string, any>,
  hrefMap: Map<string, string>,
  depth: number,
) {
  const entries = Array.from(tree.entries());
  const folders = entries.filter(([, v]) => v instanceof Map);
  const files = entries.filter(([, v]) => typeof v === "string");

  for (const [name, subtree] of folders) {
    const folderEl = document.createElement("div");
    folderEl.style.paddingLeft = `${depth * 12}px`;

    const label = document.createElement("span");
    label.className =
      "flex items-center gap-1 py-0.5 text-xs font-medium text-gray-500";
    label.textContent = `📁 ${name}`;
    folderEl.appendChild(label);

    parent.appendChild(folderEl);
    renderTreeLevel(parent, subtree, hrefMap, depth + 1);
  }

  for (const [name, fullPath] of files) {
    const fileEl = document.createElement("div");
    fileEl.style.paddingLeft = `${depth * 12}px`;

    const a = document.createElement("a");
    a.className =
      "block truncate rounded px-1 py-0.5 text-xs text-gray-700 hover:bg-gray-100";
    a.textContent = name;

    const hash = hrefMap.get(fullPath);
    if (hash) a.href = hash;

    fileEl.appendChild(a);
    parent.appendChild(fileEl);
  }
}

function renderFileTree(
  container: HTMLElement,
  outputEl: HTMLElement,
  files: string[],
) {
  container.innerHTML = "";

  const title = document.createElement("h3");
  title.className = "mb-2 text-sm font-semibold text-gray-700";
  title.textContent = "Files";
  container.appendChild(title);

  const fileLinks = outputEl.querySelectorAll<HTMLAnchorElement>(
    ".d2h-file-list a.d2h-file-name",
  );
  const hrefMap = new Map<string, string>();
  fileLinks.forEach((a) => {
    const name = a.textContent?.trim();
    if (name && a.hash) hrefMap.set(name, a.hash);
  });

  const root = new Map<string, any>();
  for (const file of files || []) {
    const parts = file.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      if (isFile) {
        current.set(part, file);
      } else {
        if (!current.has(part)) {
          current.set(part, new Map<string, any>());
        }
        current = current.get(part);
      }
    }
  }

  const treeContainer = document.createElement("div");
  treeContainer.className = "flex flex-col";
  renderTreeLevel(treeContainer, root, hrefMap, 0);
  container.appendChild(treeContainer);
}

function renderCommentIndicators(
  outputEl: HTMLElement,
  comments: Comment[],
  onDelete: (comment: Comment) => void,
) {
  outputEl.querySelectorAll(".towelie-comment-btn").forEach((el) => {
    if (el.tagName === "TR") {
      el.querySelectorAll(".d2h-code-side-linenumber").forEach((ln) => {
        (ln as HTMLElement).style.backgroundColor = "";
      });
      el.classList.remove("towelie-comment-btn");
    } else {
      el.remove();
    }
  });
  outputEl
    .querySelectorAll(".towelie-comment-popup")
    .forEach((popup) => popup.remove());

  if (comments.length === 0) return;

  const fileWrappers = Array.from(
    outputEl.querySelectorAll(".d2h-file-wrapper"),
  );

  for (const comment of comments) {
    const { fileName, startLine, diffSide } = comment.selection;

    for (const wrapper of fileWrappers) {
      const fileNameEl = wrapper.querySelector(".d2h-file-name");
      const wrapperFileName = fileNameEl?.textContent?.trim();
      if (wrapperFileName !== fileName) continue;

      const filesDiv = wrapper.querySelector(".d2h-files-diff");
      if (!filesDiv) continue;

      const sides = Array.from(
        filesDiv.querySelectorAll(":scope > .d2h-file-side-diff"),
      );
      const sideContainer = diffSide === DiffSide.Old ? sides[0] : sides[1];
      if (!sideContainer) continue;

      const { endLine } = comment.selection;
      const lineNumberEls = Array.from(
        sideContainer.querySelectorAll(".d2h-code-side-linenumber"),
      );
      let firstRow: HTMLElement | null = null;
      for (const lineEl of lineNumberEls) {
        const num = Number((lineEl as HTMLElement).textContent);
        if (isNaN(num) || num < startLine || num > endLine) continue;

        const row = (lineEl as HTMLElement).closest("tr") as HTMLElement;
        if (!row) continue;

        row.classList.add("towelie-comment-btn");
        (lineEl as HTMLElement).style.backgroundColor =
          "rgba(250, 204, 21, 0.15)";

        if (!firstRow) firstRow = row;
      }

      if (!firstRow) continue;
      firstRow.style.position = "relative";

      const btn = document.createElement("button");
      btn.className =
        "towelie-comment-btn absolute -left-1 top-0 w-5 h-5 rounded-full bg-yellow-400 text-[10px] leading-5 text-center cursor-pointer hover:bg-yellow-500 z-10";
      btn.textContent = "💬";
      btn.title = comment.text;

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const existing = firstRow!.querySelector(".towelie-comment-popup");
        if (existing) {
          existing.remove();
          return;
        }
        const popup = document.createElement("div");
        popup.className =
          "towelie-comment-popup absolute left-6 top-0 w-64 p-2 bg-white border border-gray-300 rounded shadow-lg text-sm z-20";
        popup.addEventListener("click", (ev) => ev.stopPropagation());

        const textEl = document.createElement("p");
        textEl.textContent = comment.text;
        popup.appendChild(textEl);

        const deleteBtn = document.createElement("button");
        deleteBtn.className =
          "mt-2 rounded bg-red-500 px-2 py-0.5 text-xs text-white hover:bg-red-600";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => onDelete(comment));
        popup.appendChild(deleteBtn);
        firstRow!.appendChild(popup);

        const close = () => {
          popup.remove();
          document.removeEventListener("click", close);
        };
        document.addEventListener("click", close);
      });

      firstRow.appendChild(btn);
    }
  }
}

function showInlineCommentForm(
  anchor: HTMLElement,
  selection: Selection,
  onSubmit: (selection: Selection, text: string) => void,
): HTMLElement {
  const { fileName, startLine, endLine, diffSide } = selection;

  const form = document.createElement("tr");
  form.innerHTML = `
    <td colspan="99" class="p-2 bg-yellow-50 border border-yellow-200">
      <div class="flex flex-col gap-2">
        <span class="text-xs text-gray-500">${fileName} (${diffSide}) : ${startLine}-${endLine}</span>
        <textarea
          class="w-full rounded border border-gray-300 p-2 text-sm"
          rows="3"
          placeholder="Write a comment..."
        ></textarea>
        <div class="flex gap-2">
          <button
            type="button"
            class="rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600"
            data-action="submit"
          >
            Comment
          </button>
          <button
            type="button"
            class="rounded bg-gray-200 px-3 py-1 text-sm hover:bg-gray-300"
            data-action="cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    </td>
  `;

  form
    .querySelector('[data-action="submit"]')!
    .addEventListener("click", () => {
      const textarea = form.querySelector("textarea")!;
      const text = textarea.value.trim();
      if (text) {
        onSubmit(selection, text);
        form.remove();
      }
    });

  form
    .querySelector('[data-action="cancel"]')!
    .addEventListener("click", () => {
      form.remove();
    });

  anchor.insertAdjacentElement("afterend", form);
  form.querySelector("textarea")!.focus();
  return form;
}


export default class ReviewController extends Controller {
  static targets = [
    "output",
    "fileExplorer",
    "branchSelect",
    "baseBranchSelect",
    "commitSelect",
    "sidebar",
    "sidebarToggle",
  ];

  declare readonly outputTarget: HTMLElement;
  declare readonly fileExplorerTarget: HTMLElement;
  declare readonly branchSelectTarget: HTMLSelectElement;
  declare readonly baseBranchSelectTarget: HTMLSelectElement;
  declare readonly commitSelectTarget: HTMLSelectElement;
  declare readonly sidebarTarget: HTMLElement;
  declare readonly sidebarToggleTarget: HTMLElement;

  private storage = new CommentStorage();
  private activeForm: HTMLElement | null = null;
  private selection: Partial<Selection> | null = null;
  private sidebarVisible = true;

  async connect() {
    this.storage.load();
    await this.reloadReview();

    this.outputTarget.addEventListener("mousedown", (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (!e.target.classList.contains("d2h-code-side-linenumber")) return;
      const lineNumber = Number(e.target.textContent);
      if (isNaN(lineNumber)) return;

      const fileDiffContainer = e.target.closest(".d2h-file-wrapper")!;
      const fileName =
        fileDiffContainer
          .querySelector(".d2h-file-name")
          ?.textContent?.trim() || "unknown";

      const filesDiv = e.target.closest(".d2h-files-diff");
      let diffSide = DiffSide.New;
      if (filesDiv) {
        const sides = Array.from(
          filesDiv.querySelectorAll(":scope > .d2h-file-side-diff"),
        );
        const sideDiv = e.target.closest(".d2h-file-side-diff");
        if (sideDiv === sides[0]) diffSide = DiffSide.Old;
      }

      if (this.selection === null) {
        this.selection = { fileName, startLine: lineNumber, diffSide };
        return;
      }
      this.selection.endLine = lineNumber;
      const sel = this.selection as Selection;

      const row =
        e.target.closest("tr") ||
        e.target.closest(".d2h-code-line-ctn")?.parentElement;
      if (!row) return;

      this.selection = null;
      if (this.activeForm) {
        this.activeForm.remove();
        this.activeForm = null;
      }
      this.activeForm = showInlineCommentForm(
        row as HTMLElement,
        sel,
        (selection, text) => {
          const branch = this.branchSelectTarget.value || "current";
          this.storage.add(selection, text, branch);
          this.activeForm = null;
          this.renderComments();
        },
      );
    });
  }

  branchChanged() {
    this.commitSelectTarget.value = "";
    this.reloadReview();
  }

  async reloadReview() {
    const branch = this.branchSelectTarget.value;
    const base = this.baseBranchSelectTarget.value;
    const commit = this.commitSelectTarget.value;

    const params = new URLSearchParams();
    if (branch) params.set("branch", branch);
    if (base) params.set("base", base);
    if (commit) params.set("commit", commit);

    const url = params.toString()
      ? `/api/diff?${params.toString()}`
      : "/api/diff";
    const res = await fetch(url);
    const data: DiffResponse = await res.json();

    this.outputTarget.innerHTML = "";
    const diff2htmlUi = new Diff2HtmlUI(this.outputTarget, data.diff, {
      drawFileList: true,
      matching: "lines",
      outputFormat: "side-by-side",
    });
    diff2htmlUi.draw();
    renderFileTree(this.fileExplorerTarget, this.outputTarget, data.files);
    populateCommitSelect(this.commitSelectTarget, data);
    populateBranchSelects(
      this.branchSelectTarget,
      this.baseBranchSelectTarget,
      data,
    );
    this.storage.load();
    this.renderComments();
  }

  toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible;
    if (this.sidebarVisible) {
      this.sidebarTarget.style.display = "";
      this.sidebarToggleTarget.textContent = "◀";
    } else {
      this.sidebarTarget.style.display = "none";
      this.sidebarToggleTarget.textContent = "▶";
    }
  }

  async finishReview(e: Event) {
    const btn = e.currentTarget as HTMLButtonElement;
    const currentBranch = this.branchSelectTarget.value || "current";
    const branchComments = this.storage.forBranch(currentBranch);

    if (branchComments.length === 0) {
      flashButton(btn, "No comments to copy", 2000);
      return;
    }

    const blocks = branchComments.map((c) => {
      const s = c.selection;
      const sideLabel =
        s.diffSide === DiffSide.Old
          ? "old code (before the change)"
          : "new code (after the change)";
      return `${s.fileName} lines ${s.startLine}-${s.endLine} on the ${sideLabel}\n\n\`\`\`\n${c.text}\n\`\`\``;
    });
    const reviewText =
      "Here's the review of the user:\n\n" + blocks.join("\n\n---\n\n");

    await navigator.clipboard.writeText(reviewText);
    this.storage.clearBranch(currentBranch);
    this.renderComments();
    flashButton(btn, "Copied to clipboard!", 2000);
  }

  private renderComments() {
    const branch = this.branchSelectTarget.value || "current";
    renderCommentIndicators(
      this.outputTarget,
      this.storage.forBranch(branch),
      (comment) => {
        this.storage.remove(comment);
        this.renderComments();
      },
    );
  }
}
