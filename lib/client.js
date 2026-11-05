window.__ModuleLoader__.load({
	id: "dsh-skills-management",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const {
			Button,
			Input,
			IconRefreshOutlineRegular,
			IconTrashOutlineRegular,
			StateDot,
			Switch,
			Tag
		} = require("@deepseek-ai/dsh-client-ui-primitives");
		const h = React.createElement;

		const PACKAGE_ID = "dsh-skills-management";
		const PANEL_ID = "skills-management";
		const PANEL_ORDER = 40;
		const STYLE_ID = "dsh-skills-management-styles";
		const API = {
			list: "api/dsh-skills-management/list",
			set: "api/dsh-skills-management/set"
		};
		const inject = ["slots", "layout"];

		const CSS = `
.skp-view{height:100%;min-height:0;overflow:hidden}
.skp-panel{--skp-page-inset:clamp(24px, 4vw, 48px);box-sizing:border-box;min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);flex-direction:column;align-items:center;padding:0 var(--skp-page-inset);display:flex;overflow:hidden}
@media (width<=767px){.skp-panel{--skp-page-inset:20px}}
.skp-panel-header{box-sizing:border-box;width:100%;max-width:960px;flex:none;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:32px;padding-top:28px;display:flex}
.skp-panel-heading{min-width:0;max-width:100%;order:1}
.skp-panel-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.skp-panel-intro{color:var(--dsw-alias-label-secondary);align-items:center;gap:4px;margin:4px 0 0;font-size:13px;line-height:20px;display:flex}
.skp-refresh-button{border-radius:var(--dsw-radius-md);height:32px;flex:none;padding:0 12px;font-size:13px;line-height:20px;order:2}
.skp-fill-body{width:100%;max-width:960px;flex-direction:column;flex:1;min-height:0;display:flex;overflow:visible}
.skp-search-row{align-items:center;flex:none;gap:8px;margin:0 0 24px;display:flex}
.skp-search-input{width:100%;min-width:0}
.skp-filter{position:relative;flex:none}
.skp-filter-button{border-radius:var(--dsw-radius-md);width:32px;height:32px;padding:0;font-size:13px;line-height:20px;position:relative}
.skp-filter-button[data-active]{color:var(--dsw-alias-state-business-primary);--dsh-button-outline-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.skp-filter-option:focus-visible,.skp-filter-reset:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.skp-filter-dot{position:absolute;top:5px;right:5px;width:4px;height:4px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}
.skp-filter-popover{box-sizing:border-box;z-index:30;position:absolute;top:calc(100% + 6px);right:0;width:300px;max-width:calc(100vw - 40px);max-height:420px;overflow:auto;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);border:0;border-radius:var(--dsw-radius-xl);box-shadow:var(--dsw-elevation-prominent);flex-direction:column;gap:12px;padding:12px;display:flex}
.skp-filter-head{align-items:center;justify-content:space-between;gap:8px;display:flex}
.skp-filter-heading{font-size:13px;font-weight:500;line-height:20px}
.skp-filter-reset{color:var(--dsw-alias-state-business-primary);cursor:pointer;background:0 0;border:0;border-radius:var(--dsw-radius-sm);padding:2px 4px;font:inherit;font-size:12px}
.skp-filter-reset:disabled{color:var(--dsw-alias-label-caption);cursor:default;opacity:.5}
.skp-filter-section{flex-direction:column;gap:6px;display:flex}
.skp-filter-label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.skp-filter-options{flex-wrap:wrap;gap:4px;display:flex}
.skp-filter-option{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:var(--dsw-radius-md);padding:4px 8px;font:inherit;font-size:12px;line-height:20px}
.skp-filter-option:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.skp-filter-option[data-active]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary);font-weight:500}
.skp-banner{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;align-items:center;flex-wrap:wrap;gap:10px;margin:0 0 24px;font-size:13px;line-height:20px;display:flex}
.skp-banner[data-kind=error]{color:var(--dsw-alias-state-error-primary)}
.skp-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.skp-list{flex-direction:column;flex:1;gap:32px;min-height:0;margin:0 -8px;padding:0 8px 48px;display:flex;overflow:hidden auto}
.skp-group{flex-direction:column;gap:8px;display:flex}
.skp-group-toggle{box-sizing:border-box;width:100%;min-height:22px;color:var(--dsw-alias-label-primary);cursor:pointer;user-select:none;text-align:left;background:0 0;border:0;border-radius:var(--dsw-radius-sm);align-items:center;gap:8px;padding:0;font:inherit;display:flex}
.skp-group-toggle:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.skp-group-caret{width:14px;height:14px;color:var(--dsw-alias-label-caption);flex:none;transition:transform .15s var(--ds-ease-in-out)}
.skp-group-toggle[aria-expanded=true] .skp-group-caret{transform:rotate(90deg)}
@media(prefers-reduced-motion:reduce){.skp-group-caret{transition:none}}
.skp-group-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.skp-group-title{margin:0;font-size:14px;font-weight:500;line-height:22px}
.skp-count{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
.skp-group-cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.skp-skill-row{border-radius:var(--dsw-radius-xl);min-width:0;margin:0 -8px;position:relative}
.skp-skill-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.skp-skill-row:active{background:var(--dsw-alias-interactive-bg-active)}
.skp-card-head{align-items:center;gap:14px;padding:8px;display:flex}
.skp-card-main{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.skp-title-row{flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}
.skp-skill-name{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:100%;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}
.skp-status-tag{height:18px;flex:none;padding:0 7px;font-size:10px;line-height:1}
.skp-card-end{z-index:1;flex:none;align-items:center;gap:8px;display:inline-flex;position:relative}
.skp-delete-button{color:var(--dsw-alias-label-critical);flex:none}
.skp-readonly{color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:12.5px;line-height:18px}
.skp-switch-fields{align-items:center;gap:8px;display:flex}
.skp-switch-field{white-space:nowrap;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:18px;display:inline-flex}
.skp-skill-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}
@media(max-width:700px){
.skp-panel-header{margin-bottom:24px}
.skp-switch-field>span{display:none}
}
`;

		function ensureStyles() {
			if (typeof document === "undefined") return;
			let style = document.getElementById(STYLE_ID);
			if (!style) {
				style = document.createElement("style");
				style.id = STYLE_ID;
				style.type = "text/css";
				style.dataset.plugin = PACKAGE_ID;
				style.dataset.pluginCss = PACKAGE_ID + "/panel.css";
				(document.head || document.documentElement).appendChild(style);
			}
			// HMR keeps the document and the old style element alive. Always replace
			// its contents so a new panel structure never inherits stale class rules.
			style.textContent = CSS;
		}

		function text(value, fallback) {
			if (value === null || value === void 0 || value === "") return fallback || "";
			return String(value);
		}

		const SOURCE_LABELS = {
			project: "项目技能",
			user: "全局技能",
			custom: "自定义目录",
			bundled: "系统内置",
			runtime: "运行时注册",
			missing: "当前未加载"
		};
		const STATUS_FILTERS = [
			["all", "全部状态"],
			["available", "可调用"],
			["model", "仅模型"],
			["user", "仅用户"],
			["disabled", "已禁用"],
			["missing", "未加载"]
		];
		const SOURCE_FILTERS = [
			["all", "全部来源"],
			["bundled", "系统内置"],
			["user", "全局技能"],
			["project", "项目技能"],
			["custom", "自定义目录"],
			["runtime", "运行时注册"],
			["missing", "当前未加载"]
		];

		function sourceLabel(value) {
			const key = text(value, "未知来源");
			return SOURCE_LABELS[key] || key;
		}

		function sourceGroupKey(value) {
			const source = text(value, "未知来源");
			if (source === "user-dsh" || source === "user-agents") return "user";
			if (source === "project-dsh" || source === "project-agents") return "project";
			return source;
		}

		function sourceGroupOrder(source) {
			if (source === "bundled") return 0;
			if (source === "user") return 1;
			if (source === "project") return 2;
			if (source === "custom") return 3;
			if (source === "runtime") return 4;
			if (source === "missing") return 5;
			return 6;
		}

		async function responseJson(response) {
			let payload = null;
			try {
				payload = await response.json();
			} catch (error) {
				if (response.ok) throw new Error("服务返回了无效的 JSON。");
			}
			if (!response.ok) {
				const detail = payload && (payload.error || payload.message);
				const error = new Error(text(detail, "请求失败（HTTP " + response.status + "）。"));
				error.status = response.status;
				error.code = payload && payload.code;
				throw error;
			}
			return payload;
		}

		function PanelIcon(props) {
			const size = props && props.size ? props.size : 16;
			return h("svg", {
				"data-dsh-panel-entry": PANEL_ID,
				viewBox: "0 0 16 16",
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true"
			},
				h("path", { d: "M8 2.1l1.55 4.35L13.9 8l-4.35 1.55L8 13.9l-1.55-4.35L2.1 8l4.35-1.55L8 2.1z" })
			);
		}

		function WorkspaceTriangleIcon() {
			return h("svg", {
				className: "skp-group-caret",
				viewBox: "0 0 16 16",
				width: 14,
				height: 14,
				fill: "none",
				"aria-hidden": "true"
			}, h("path", {
				d: "M5.5 4.5C5.5 4.40714 5.52586 4.31612 5.57467 4.23713C5.62349 4.15815 5.69334 4.09431 5.77639 4.05279C5.85945 4.01126 5.95242 3.99368 6.0449 4.00202C6.13738 4.01036 6.22572 4.04429 6.3 4.1L10.967 7.6C11.0291 7.64657 11.0795 7.70697 11.1142 7.77639C11.1489 7.84582 11.167 7.92238 11.167 8C11.167 8.07762 11.1489 8.15418 11.1142 8.22361C11.0795 8.29303 11.0291 8.35343 10.967 8.4L6.3 11.9C6.22572 11.9557 6.13738 11.9896 6.0449 11.998C5.95242 12.0063 5.85945 11.9887 5.77639 11.9472C5.69334 11.9057 5.62349 11.8419 5.57467 11.7629C5.52586 11.6839 5.5 11.5929 5.5 11.5V4.5Z",
				fill: "currentColor"
			}));
		}

		function FilterIcon() {
			return h("svg", {
				viewBox: "0 0 16 16",
				width: 16,
				height: 16,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1,
				strokeLinecap: "round",
				"aria-hidden": "true"
			},
				h("path", { d: "M2.3 5h5.85M12.05 5h1.65" }),
				h("circle", { cx: "9.95", cy: "5", r: "1.45" }),
				h("path", { d: "M2.3 11h1.65M7.85 11h5.85" }),
				h("circle", { cx: "5.75", cy: "11", r: "1.45" })
			);
		}

		function invocationStatusKind(skill) {
			if (skill.missing) return "missing";
			const modelEnabled = skill.modelInvocable !== false;
			const userEnabled = skill.userInvocable !== false;
			if (modelEnabled && userEnabled) return "available";
			if (modelEnabled) return "model";
			if (userEnabled) return "user";
			return "disabled";
		}

		function invocationStatus(skill) {
			const kind = invocationStatusKind(skill);
			if (kind === "missing") return { label: "已禁用", tone: "danger" };
			if (kind === "available") return { label: "可调用", tone: "success" };
			if (kind === "model") return { label: "仅模型", tone: "warning" };
			if (kind === "user") return { label: "仅用户", tone: "warning" };
			return { label: "已禁用", tone: "danger" };
		}

		function fileStateLabel(skill) {
			if (skill.missing) return "未加载";
			if (skill.linked) return "Junction";
			if (skill.fileState === "file") return "本地文件";
			if (skill.fileState === "provider-file") return "来源文件";
			if (skill.provider === PACKAGE_ID) return "路径失效";
			if (skill.source === "bundled") return "内置资源";
			if (skill.provider === "filesystem") return "仅注册";
			return "非文件";
		}

		function SkillRow(props) {
			const skill = props.skill;
			const name = text(skill.name, "未命名 Skill");
			const description = text(skill.description, "无说明");
			const provider = text(skill.provider, "未知 provider");
			const missing = Boolean(skill.missing);
			const modelEnabled = skill.modelInvocable !== false;
			const userEnabled = skill.userInvocable !== false;
			const fileLabel = fileStateLabel(skill);
			const whenToUse = text(skill.whenToUse, "");
			const descriptionTitle = whenToUse ? description + "\n适用场景：" + whenToUse : description;
			const status = invocationStatus(skill);
			const switches = [
				["model", "模型", modelEnabled],
				["user", "用户", userEnabled]
			];

			return h("li", {
				className: "skp-skill-row",
				"data-dsh-part": "skill-row"
			}, h("div", { className: "skp-card-head" },
				h("div", { className: "skp-card-main" },
					h("div", { className: "skp-title-row" },
						h("span", { className: "skp-skill-name", title: name }, name),
						h(Tag, { className: "skp-status-tag" }, provider),
						h(Tag, { className: "skp-status-tag" }, fileLabel),
						h(Tag, { className: "skp-status-tag", tone: status.tone }, status.label)
					),
					h("span", { className: "skp-skill-desc", title: descriptionTitle }, description)
				),
				h("div", { className: "skp-card-end" },
					missing ? h(Button, {
						variant: "outline",
						size: "sm",
						className: "skp-delete-button",
						icon: h(IconTrashOutlineRegular, { size: 13 }),
						"aria-label": "删除 " + name + " 的未加载策略",
						disabled: props.disabled,
						onClick: () => props.onRemovePolicy(skill)
					}, "删除") : skill.manageable === true ? h("div", { className: "skp-switch-fields", role: "group", "aria-label": "调用通道" },
						switches.map(([channel, label, enabled]) =>
							h("span", { className: "skp-switch-field", key: channel },
								h("span", null, label),
								h(Switch, {
									checked: enabled,
									label: name + "：" + label,
									disabled: props.disabled,
									onChange: (next) => props.onToggleChannel(skill, channel, next)
								})
							)
						)
					) : h("span", { className: "skp-readonly" }, "仅显示")
				)
			));
		}

		function SkillPolicyPanel() {
			const [data, setData] = React.useState(null);
			const [loading, setLoading] = React.useState(true);
			const [error, setError] = React.useState("");
			const [conflictName, setConflictName] = React.useState("");
			const [search, setSearch] = React.useState("");
			const [statusFilter, setStatusFilter] = React.useState("all");
			const [sourceFilter, setSourceFilter] = React.useState("all");
			const [filterOpen, setFilterOpen] = React.useState(false);
			const [collapsed, setCollapsed] = React.useState(() => new Set(["bundled"]));
			const [pending, setPending] = React.useState(false);
			const mountedRef = React.useRef(false);
			const requestVersionRef = React.useRef(0);
			const listAbortRef = React.useRef(null);
			const mutationAbortRef = React.useRef(null);
			const filterRef = React.useRef(null);

			const load = React.useCallback(async () => {
				const version = ++requestVersionRef.current;
				if (listAbortRef.current) listAbortRef.current.abort();
				const controller = new AbortController();
				listAbortRef.current = controller;
				if (mountedRef.current) {
					setLoading(true);
					setError("");
				}
				try {
					const response = await fetch(API.list, {
						method: "GET",
						headers: { accept: "application/json" },
						signal: controller.signal
					});
					const payload = await responseJson(response);
					if (!payload || !Array.isArray(payload.skills)) {
						throw new Error("服务返回格式不正确：缺少 skills。");
					}
					if (!mountedRef.current || version !== requestVersionRef.current) return;
					setData(payload);
				} catch (requestError) {
					if (!mountedRef.current || version !== requestVersionRef.current || requestError.name === "AbortError") return;
					setError(text(requestError && requestError.message, "无法加载 Skill 列表。"));
				} finally {
					if (mountedRef.current && version === requestVersionRef.current) {
						setLoading(false);
						if (listAbortRef.current === controller) listAbortRef.current = null;
					}
				}
			}, []);

			React.useEffect(() => {
				mountedRef.current = true;
				load();
				return () => {
					mountedRef.current = false;
					requestVersionRef.current += 1;
					if (listAbortRef.current) listAbortRef.current.abort();
					if (mutationAbortRef.current) mutationAbortRef.current.abort();
				};
			}, [load]);

			React.useEffect(() => {
				if (!filterOpen || typeof document === "undefined") return undefined;
				const closeOnOutside = (event) => {
					if (filterRef.current && !filterRef.current.contains(event.target)) setFilterOpen(false);
				};
				const closeOnEscape = (event) => {
					if (event.key === "Escape") setFilterOpen(false);
				};
				document.addEventListener("pointerdown", closeOnOutside);
				document.addEventListener("keydown", closeOnEscape);
				return () => {
					document.removeEventListener("pointerdown", closeOnOutside);
					document.removeEventListener("keydown", closeOnEscape);
				};
			}, [filterOpen]);

			const skills = data ? data.skills : [];
			const normalizedSearch = search.trim().toLocaleLowerCase();
			const activeFilterCount = (statusFilter !== "all" ? 1 : 0) + (sourceFilter !== "all" ? 1 : 0);
			React.useEffect(() => {
				if (!normalizedSearch && statusFilter === "all" && sourceFilter === "all") return;
				setCollapsed((previous) => {
					if (!previous.has("bundled")) return previous;
					const next = new Set(previous);
					next.delete("bundled");
					return next;
				});
			}, [normalizedSearch, statusFilter, sourceFilter]);
			const filteredSkills = skills.filter((skill) => {
				if (sourceFilter !== "all" && sourceGroupKey(skill.source) !== sourceFilter) return false;
				if (statusFilter !== "all" && invocationStatusKind(skill) !== statusFilter) return false;
				if (!normalizedSearch) return true;
				const haystack = [skill.name, skill.description]
					.map((value) => text(value, "")).join("\n").toLocaleLowerCase();
				return haystack.includes(normalizedSearch);
			});
			const groups = new Map();
			if (sourceFilter !== "all") groups.set(sourceFilter, []);
			if (sourceFilter === "all" || sourceFilter === "bundled") groups.set("bundled", []);
			for (const skill of filteredSkills) {
				const source = sourceGroupKey(skill.source);
				if (!groups.has(source)) groups.set(source, []);
				groups.get(source).push(skill);
			}
			const orderedGroups = Array.from(groups.entries()).sort(([left], [right]) =>
				sourceGroupOrder(left) - sourceGroupOrder(right) || left.localeCompare(right, "zh-CN")
			);
			const controlsLocked = pending || loading;

			function refresh() {
				setConflictName("");
				load();
			}

			function resetFilters() {
				setStatusFilter("all");
				setSourceFilter("all");
			}

			function toggleSource(source) {
				setCollapsed((previous) => {
					const next = new Set(previous);
					if (next.has(source)) next.delete(source);
					else next.add(source);
					return next;
				});
			}

			async function toggleChannel(skill, channel, enabledOverride) {
				if (controlsLocked) return;
				const name = text(skill.name, "");
				if (!name) {
					setError("该 Skill 缺少 name，无法修改。");
					return;
				}
				const currentlyEnabled = channel === "both"
					? skill.modelInvocable !== false && skill.userInvocable !== false
					: channel === "model" ? skill.modelInvocable !== false : skill.userInvocable !== false;
				const enabled = enabledOverride === undefined ? !currentlyEnabled : enabledOverride;
				const controller = new AbortController();
				mutationAbortRef.current = controller;
				setPending(true);
				setError("");
				setConflictName("");
				try {
					const response = await fetch(API.set, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"x-dsh-skills-management": "1"
						},
						body: JSON.stringify({ name, channel, enabled }),
						signal: controller.signal
					});
					await responseJson(response);
					if (!mountedRef.current) return;
					await load();
				} catch (requestError) {
					if (!mountedRef.current || requestError.name === "AbortError") return;
					if (requestError.code === "conflicting-original" && !enabled) setConflictName(name);
					setError(text(requestError && requestError.message, "无法修改调用状态。"));
				} finally {
					if (mutationAbortRef.current === controller) mutationAbortRef.current = null;
					if (mountedRef.current) setPending(false);
				}
			}

			async function removePolicy(skill) {
				if (controlsLocked) return;
				const name = text(skill.name, "");
				if (!name) {
					setError("该 Skill 缺少 name，无法删除策略。");
					return;
				}
				const controller = new AbortController();
				mutationAbortRef.current = controller;
				setPending(true);
				setError("");
				setConflictName("");
				try {
					const response = await fetch(API.set, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"x-dsh-skills-management": "1"
						},
						body: JSON.stringify({ name, action: "remove" }),
						signal: controller.signal
					});
					await responseJson(response);
					if (!mountedRef.current) return;
					await load();
				} catch (requestError) {
					if (!mountedRef.current || requestError.name === "AbortError") return;
					setError(text(requestError && requestError.message, "无法删除未加载策略。"));
				} finally {
					if (mutationAbortRef.current === controller) mutationAbortRef.current = null;
					if (mountedRef.current) setPending(false);
				}
			}

			function renderFilterSection(title, options, current, select) {
				return h("div", { className: "skp-filter-section" },
					h("div", { className: "skp-filter-label" }, title),
					h("div", { className: "skp-filter-options" }, options.map(([value, label]) =>
						h("button", {
							type: "button",
							className: "skp-filter-option",
							key: value,
							"data-active": current === value ? "" : undefined,
							"aria-pressed": current === value ? "true" : "false",
							onClick: () => select(value)
						}, label)
					))
				);
			}

			return h("section", { className: "skp-panel", "aria-label": "技能管理" },
				h("header", { className: "skp-panel-header" },
					h("div", { className: "skp-panel-heading" },
						h("h1", {
							className: "skp-panel-title"

						}, "技能管理"),
						h("p", { className: "skp-panel-intro" }, "管理文件型 Skill 的模型与用户手动调用。")
					),
					h(Button, {
						variant: "outline",
						size: "sm",
						className: "skp-refresh-button",
						onClick: refresh,
						disabled: controlsLocked,

						"aria-label": "刷新",
						"aria-busy": loading,
						icon: loading ? h(StateDot, { state: "ongoing", size: 13 }) : h(IconRefreshOutlineRegular, { size: 13 })
					}, h("span", null, "刷新"))
				),
				h("div", { className: "skp-fill-body" },
					h("div", { className: "skp-search-row" },
						h(Input, {
							className: "skp-search-input",
							type: "search",
							value: search,
							spellCheck: false,
							onChange: (event) => setSearch(event.target.value),
							onKeyDown: (event) => {
								if (event.key === "Escape" && search !== "") setSearch("");
							},
							placeholder: "按名称或描述筛选",
							"aria-label": "按名称或描述筛选技能"
						}),
						h("div", { className: "skp-filter", ref: filterRef },
							h(Button, {
								variant: "outline",
								size: "sm",
								className: "skp-filter-button",
								"data-active": filterOpen || activeFilterCount > 0 ? "" : undefined,
								"aria-label": activeFilterCount > 0 ? "筛选，已启用 " + activeFilterCount + " 项" : "筛选",
								"aria-expanded": filterOpen ? "true" : "false",
								"aria-haspopup": "dialog",

								onClick: () => setFilterOpen((open) => !open)
							}, h(FilterIcon), activeFilterCount > 0 && h("span", { className: "skp-filter-dot", "aria-hidden": "true" })),
							filterOpen && h("div", { className: "skp-filter-popover", role: "dialog", "aria-label": "Skill 筛选" },
								h("div", { className: "skp-filter-head" },
									h("span", { className: "skp-filter-heading" }, "筛选"),
									h("button", {
										type: "button",
										className: "skp-filter-reset",
										onClick: resetFilters,
										disabled: activeFilterCount === 0
									}, "重置")
								),
								renderFilterSection("调用状态", STATUS_FILTERS, statusFilter, setStatusFilter),
								renderFilterSection("来源", SOURCE_FILTERS, sourceFilter, setSourceFilter)
							)
						)
					),
					error && h("div", { className: "skp-banner", "data-kind": "error", role: "alert" },
						h("span", null, "错误：" + error),
						conflictName && h(Button, {
							variant: "outline",
							size: "sm",
							onClick: () => toggleChannel({ name: conflictName }, "both", false),
							disabled: controlsLocked,

						}, "全部禁用"),
						h(Button, {
							variant: "outline",
							size: "sm",
							onClick: refresh,
							disabled: controlsLocked
						}, "重试")
					),
					loading && !data ? h("p", { className: "skp-empty", role: "status" }, "正在加载 Skill…") :
					!data ? h("p", { className: "skp-empty" }, "Skill 列表不可用，请重试。") :
					h("div", { className: "skp-list" },
						orderedGroups.map(([source, groupSkills]) => h("section", {
							className: "skp-group",
							key: source,
							"data-source": source,
							"data-collapsed": collapsed.has(source) ? "" : undefined
						},
							h("button", {
								type: "button",
								className: "skp-group-toggle",
								"aria-expanded": collapsed.has(source) ? "false" : "true",
								"data-dsh-part": "group-toggle",
								onClick: () => toggleSource(source)
							},
								h(WorkspaceTriangleIcon),
								h("span", { className: "skp-group-title" }, sourceLabel(source)),
								h("span", { className: "skp-count" }, groupSkills.length + " 个")
							),
							!collapsed.has(source) && (groupSkills.length === 0 ?
								h("p", { className: "skp-group-empty" },
									normalizedSearch || activeFilterCount > 0 ? "没有匹配的" + sourceLabel(source) :
									source === "user" ? "还没有全局技能" :
									source === "bundled" ? "暂无系统内置技能" : "暂无技能"
								) :
								h("ul", { className: "skp-group-cards" }, groupSkills.map((skill, index) =>
									h(SkillRow, {
										key: text(skill.name, "skill") + ":" + index,
										skill,
										disabled: controlsLocked,
										onToggleChannel: toggleChannel,
										onRemovePolicy: removePolicy
									})
								))
							)
						))
					)
				)
			);
		}

		function SkillPolicyPanelPage() {
			return h("div", {
				className: "skp-view",
				"data-dsh-skills-management-view": "",
				"data-dsh-plugin": PACKAGE_ID
			}, h(SkillPolicyPanel));
		}

		function registerSkillPolicyPanel(ctx) {
			const slots = ctx.slots;
			const disposers = [];
			try {
				disposers.push(slots.inject("sidebar.panellist", () => slots.register({
					name: "sidebar.panellist",
					id: PANEL_ID,
					order: PANEL_ORDER,
					label: () => "技能管理"
				}, PanelIcon)));
				disposers.push(slots.inject("main", () => slots.register({
					name: "main",
					key: PANEL_ID
				}, SkillPolicyPanelPage)));
			} catch (error) {
				for (const dispose of disposers.splice(0)) dispose();
				throw error;
			}
			return () => {
				for (const dispose of disposers.splice(0)) dispose();
			};
		}

		function apply(ctx) {
			ensureStyles();
			const disposers = [];
			try {
				disposers.push(registerSkillPolicyPanel(ctx));
			} catch (error) {
				console.warn("[dsh-skills-management] panel registration failed:", error);
			}
			ctx.effect(() => () => {
				for (const dispose of disposers.splice(0)) dispose();
			}, "dsh-skills-management: ui mounts");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
