window.__ModuleLoader__.load({
	id: "dsh-telegram",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/client/locales.ts
		/** English copy. */
		const en = {
			token: "Bot token",
			tokenHint: "Message @BotFather in Telegram and send /newbot. Stored on this machine and never shown again; leave blank to keep the current token.",
			tokenInvalid: "This does not look like a bot token (123456789:AAH…); copy the whole token BotFather gave you.",
			tokenSet: "Configured",
			tokenUnset: "Not configured",
			userIds: "Allowed user ids",
			userIdsHint: "Your numeric Telegram user id (ask @userinfobot); separate several with commas. Empty means the bot answers nobody.",
			userIdsInvalid: "Enter positive integer ids separated by commas.",
			overridden: "Set",
			reset: "Clear",
			readOnly: "This deployment stores settings read-only.",
			unavailable: "The plugin is not loaded, so it cannot be configured right now. Make sure dsh-telegram is enabled, or restart DSH.",
			save: "Save",
			saving: "Saving…",
			saveFailed: "DSH did not accept these settings; they were left for you to correct."
		};
		/** Chinese copy. */
		const zh = {
			token: "Bot Token",
			tokenHint: "在 Telegram 中私聊 @BotFather 发送 /newbot 获取。只保存在本机，不会回显；留空则保留当前 Token。",
			tokenInvalid: "格式不对：应类似 123456789:AAH…，请完整复制 BotFather 给出的 Token。",
			tokenSet: "已配置",
			tokenUnset: "未配置",
			userIds: "允许的用户 ID",
			userIdsHint: "你的 Telegram 数字用户 ID，可私聊 @userinfobot 查看；多个用逗号分隔。为空时机器人不回复任何人。",
			userIdsInvalid: "只能填写正整数 ID，多个用逗号分隔。",
			overridden: "已设置",
			reset: "清空",
			readOnly: "当前部署的配置文件是只读的。",
			unavailable: "插件尚未加载，暂时无法配置。请确认 dsh-telegram 已启用，或重启 DSH 后再试。",
			save: "保存",
			saving: "保存中…",
			saveFailed: "DSH 没有接受这些设置，已保留供你修改。"
		};
		/**
		* The form frame's copy, read from this form's dictionary.
		* @param t - the form's locale reader.
		* @returns the labels the shared settings form renders.
		*/
		function formLabels(t) {
			return {
				unavailable: t("unavailable"),
				readOnly: t("readOnly"),
				saveFailed: t("saveFailed"),
				save: t("save"),
				saving: t("saving")
			};
		}
		// src/client/TelegramSettings.tsx
		/**
		* Render the bot settings form.
		* @param props - locale copy, the form snapshot, and its actions.
		* @returns the form.
		*/
		function TelegramSettings(props) {
			const { t } = props;
			const state = props.useTelegramSettings((snapshot) => snapshot);
			const disabled = !state.writable || state.saving;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.SettingsForm, {
				labels: formLabels(t),
				state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsSecretField, {
					id: "plugin-config-telegram-token",
					label: t("token"),
					hint: state.tokenInvalid ? t("tokenInvalid") : t("tokenHint"),
					disabled,
					text: state.token.text,
					configured: state.tokenConfigured,
					stateLabel: state.tokenConfigured ? t("tokenSet") : t("tokenUnset"),
					onEdit: (text) => {
						props.edit("token", text);
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
					id: "plugin-config-telegram-user-ids",
					label: t("userIds"),
					hint: t("userIdsHint"),
					placeholder: "123456789",
					numeric: true,
					overriddenLabel: t("overridden"),
					resetLabel: t("reset"),
					invalidLabel: t("userIdsInvalid"),
					disabled,
					...state.userIds,
					onEdit: (text) => {
						props.edit("allowedUserIds", text);
					},
					onReset: () => {
						props.resetField("allowedUserIds");
					}
				})]
			});
		}
		// src/client/settings-controller.ts
		/** Settings namespace: the row id the bundle patch declares. */
		const TELEGRAM_ENTRY = "telegram";
		/**
		* Parse allowlist text.
		* @param text - ids separated by commas, spaces or newlines.
		* @returns unique ids, or undefined when any part is not a positive safe integer.
		*/
		function parseUserIds(text) {
			const parts = text.split(/[\s,，]+/).filter(Boolean);
			if (parts.some((part) => !/^[1-9]\d*$/.test(part) || !Number.isSafeInteger(Number(part)))) return void 0;
			return [...new Set(parts.map(Number))];
		}
		/**
		* @param token - a trimmed draft.
		* @returns whether it has the `<bot id>:<secret>` shape BotFather issues.
		*/
		function looksLikeToken(token) {
			return /^\d+:[\w-]{20,}$/.test(token);
		}
		/** The allowlist as one comma-separated control; emptying it clears the field. */
		const userIdsField = {
			field: "allowedUserIds",
			format: (value) => Array.isArray(value) ? value.join(", ") : "",
			parse: (text) => {
				if (!text.trim()) return { kind: "clear" };
				const ids = parseUserIds(text);
				return ids === void 0 ? void 0 : {
					kind: "set",
					value: ids
				};
			}
		};
		/** Bridges the `telegram` entry's form and its secret marker onto the settings form. */
		var TelegramSettingsController = class {
			scope;
			readTokenConfigured;
			form;
			store;
			unsubscribe;
			tokenConfigured = false;
			reads = 0;
			/**
			* @param scope - the shared configuration form of the `telegram` entry.
			* @param readTokenConfigured - asks the Host whether the token slot holds a value.
			*/
			constructor(scope, readTokenConfigured) {
				this.scope = scope;
				this.readTokenConfigured = readTokenConfigured;
				this.form = new _deepseek_ai_dsh_client_ui_primitives.SettingsFormModel(scope, [userIdsField], [{
					field: "token",
					write: (text) => this.writeToken(text)
				}]);
				this.store = this.form.bind(() => this.projection());
				this.unsubscribe = scope.subscribe(() => {
					this.refreshToken();
				});
				this.refreshToken();
			}
			projection() {
				const shell = this.form.shell();
				const token = this.form.field("token");
				const tokenInvalid = token.text.trim() !== "" && !looksLikeToken(token.text.trim());
				return {
					...shell,
					invalid: shell.invalid || tokenInvalid,
					token,
					tokenInvalid,
					tokenConfigured: this.tokenConfigured,
					userIds: this.form.field("allowedUserIds")
				};
			}
			/** Re-read the secret marker; a stale answer from an earlier read is dropped. */
			async refreshToken() {
				const read = ++this.reads;
				const configured = await this.readTokenConfigured();
				if (read === this.reads && configured !== this.tokenConfigured) {
					this.tokenConfigured = configured;
					this.store.set(this.projection());
				}
				return configured;
			}
			/**
			* Write the staged token into the section, then re-read whether one is stored.
			* @param text - the staged token.
			* @returns whether the Host accepted it.
			*/
			async writeToken(text) {
				const token = text.trim();
				if (!looksLikeToken(token)) return false;
				if (!await this.scope.mutate([{
					op: "set",
					path: ["token"],
					value: token
				}])) return false;
				return this.refreshToken();
			}
			/**
			* Build the face the form's slot registration injects.
			* @returns the form's snapshot and its actions.
			*/
			inject() {
				return {
					hooks: { telegramSettings: this.store },
					...this.form.actions()
				};
			}
			/** Release configuration subscriptions. */
			dispose() {
				this.unsubscribe();
				this.form.dispose();
			}
		};
		// src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "dshTelegram";
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.settings",
			"configForms"
		];
		/**
		* Register the dictionaries and, while the Host serves the `telegram` entry,
		* the settings form on the bundle's page.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-telegram: dictionaries");
			const settings = new TelegramSettingsController(ctx.configForms.get(TELEGRAM_ENTRY), async () => {
				const response = await ctx.remote.settings.describe();
				if (!response.ok) return false;
				return response.value.namespaces.find((view) => view.ns === "telegram")?.secrets.some((secret) => secret.path[0] === "token" && secret.set) ?? false;
			});
			ctx.effect(() => () => {
				settings.dispose();
			}, "dsh-telegram: form subscription");
			ctx.effect(() => ctx.configForms.whileServed([TELEGRAM_ENTRY], () => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
				name: "plugins.bundle.config",
				key: "dsh-telegram",
				locale: NS,
				inject: () => settings.inject()
			}, TelegramSettings))), "dsh-telegram: settings form");
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map