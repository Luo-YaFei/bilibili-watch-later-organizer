# Privacy Policy / 隐私政策

**Extension:** Bilibili Watch Later Organizer
**Effective date:** July 11, 2026
**Last updated:** October 9, 2026

## AI service update / AI 服务更新

The AI service provisions below also apply to the selected OpenAI-compatible provider and TypeSafe (Jev), rather than only OpenRouter. Their keys are stored separately in local extension storage. Jev requests go directly to `https://api.typesafe.ai/v1/systemone`, with the TypeSafe key used only for authentication. Classification sends video titles, uploader names, Bilibili sections, tags, descriptions, part titles, and category paths/keywords. No Bilibili cookies are sent to TypeSafe. The API test sends a built-in sample instead of your videos. TypeSafe's own terms and privacy policy apply: https://docs.typesafe.ai/legal . To revoke a Jev key, use your TypeSafe account.

下文关于 AI 服务的条款同样适用于用户选择的 OpenAI-compatible 服务和 TypeSafe（Jev），不只限于 OpenRouter。两类密钥分别保存在扩展本地存储中。Jev 请求直接发送至 `https://api.typesafe.ai/v1/systemone`，TypeSafe 密钥仅用于认证。视频分类会发送标题、UP 主、B站分区、标签、简介、分P标题以及分类路径和关键词，不发送 B站 Cookie。API 测试发送内置示例，不发送用户的视频。TypeSafe 的条款和隐私政策见 https://docs.typesafe.ai/legal 。如需撤销 Jev 密钥，请在 TypeSafe 账户中操作。

---

## English

### 1. Overview

Bilibili Watch Later Organizer (the “Extension”) is an independent, open-source browser extension designed to help users organize videos in their Bilibili Watch Later list through categories, keyword-based classification, batch management, and optional AI-assisted classification.

The Extension is not developed, endorsed, sponsored, or operated by Bilibili, Microsoft, OpenRouter, or any of their affiliates.

This Privacy Policy explains what information the Extension accesses, how that information is used, where it is stored, and how users can delete it.

### 2. Information accessed by the Extension

To provide its core functionality, the Extension may access information displayed on supported Bilibili pages, including:

* Video titles
* Video identifiers or links
* Watch Later list entries
* Page structure and status required to display the Extension interface
* Categories, selections, and organizational actions created by the user

The Extension accesses this information only to provide video classification, category management, and batch-management features.

The Extension does not attempt to access Bilibili passwords, payment information, private messages, or unrelated browsing content.

### 3. Information stored locally

The Extension may store the following information in browser extension storage:

* User-created categories and category structures
* Video classification results
* Keyword rules
* Extension preferences and settings
* User-provided OpenRouter API key
* Information required to preserve the Extension’s interface and operating state

This information is stored in the user’s browser environment and is not transmitted to a server operated by the Extension developer.

The OpenRouter API key is used only to authenticate requests initiated by the user. The developer does not receive, collect, or have access to the API key.

Users should treat API keys as confidential credentials and should not share them publicly.

### 4. Optional AI-assisted classification

The AI-assisted classification feature is optional.

When the user actively starts an AI classification operation, the Extension may send the following information directly from the user’s browser to the OpenRouter API:

* Selected video titles
* Available category names or category structures
* Classification instructions required to produce a result
* The user-provided OpenRouter API key for request authentication

This information is sent when the user initiates AI classification or explicitly enables scheduled/threshold-based automatic classification. Automatic classification may run in the background using the selected service. Disable automatic classification and remove the saved key to stop further automatic requests.

The information is sent to OpenRouter for the sole purpose of generating video classification suggestions or category recommendations.

Requests sent to OpenRouter are subject to OpenRouter’s own terms, privacy policy, security practices, and data-retention policies. Users should review those policies before enabling the AI-assisted feature.

The Extension developer does not control how OpenRouter processes information submitted through its API.

### 5. Developer-operated servers

The Extension does not use a server operated by the developer to collect or process user information.

Data used by the Extension is processed either:

* Locally within the user’s browser; or
* Directly between the user’s browser and OpenRouter when the user activates an AI-assisted feature.

The Extension developer does not receive copies of the user’s video titles, categories, API key, browsing activity, or classification results.

### 6. Analytics, advertising, and tracking

The Extension does not include:

* Advertising
* Behavioural tracking
* Third-party analytics
* Usage telemetry
* Fingerprinting
* Data-broker integrations
* Cryptocurrency mining
* Sale or rental of user information

The Extension does not sell, rent, or trade user information.

The Extension does not use collected information for credit assessment, insurance eligibility, employment decisions, targeted advertising, or other unrelated purposes.

### 7. Browser permissions

The Extension requests only the browser permissions required to provide its declared functionality.

Depending on the published version, these permissions may include access to:

* Browser extension storage, to save categories and settings
* Supported Bilibili pages, to display and manage Watch Later items
* The active browser tab, when the user interacts with the Extension
* OpenRouter API endpoints, when the user activates AI-assisted classification

The Extension does not use these permissions to monitor unrelated websites or browsing activity.

### 8. Data retention

Locally stored information remains in browser extension storage until one of the following occurs:

* The user deletes the information through the Extension
* The user resets the Extension
* The user clears the Extension’s browser storage
* The user removes the Extension
* The browser removes the stored information

The Extension developer does not maintain a separate copy of locally stored information.

Information sent to OpenRouter may be retained according to OpenRouter’s applicable account settings, service terms, model-provider policies, and privacy practices.

### 9. Deleting user information

Users can stop using the AI-assisted feature at any time by:

* Not configuring an OpenRouter API key
* Removing the saved OpenRouter API key
* Avoiding the AI classification command
* Using only local keyword-based classification and batch-management features

Users can delete locally stored Extension information by:

* Using any available reset or clear-data function within the Extension
* Removing saved categories, rules, settings, or API credentials
* Clearing the Extension’s storage through browser settings
* Uninstalling the Extension

After uninstalling the Extension, the browser normally removes the Extension’s locally stored data.

To invalidate an OpenRouter API key, users should also revoke or delete that key through their OpenRouter account.

### 10. Data security

The Extension is designed to minimize data transmission and keep its primary configuration and classification data within the user’s browser.

However, no browser extension, local storage mechanism, network connection, or third-party API can be guaranteed to be completely secure.

Users are responsible for:

* Protecting their browser profile and device
* Keeping their API key confidential
* Reviewing the permissions requested by the Extension
* Revoking an API key if it may have been exposed
* Keeping the Extension and browser up to date

Users should not enter an API key on a shared or untrusted device.

### 11. Third-party services and websites

The Extension operates on Bilibili pages and may optionally communicate with OpenRouter.

The Extension developer is not responsible for the privacy, security, availability, content, or data-handling practices of third-party websites, APIs, model providers, or browser platforms.

Changes made by Bilibili, OpenRouter, Microsoft Edge, Chromium, or other third parties may affect how the Extension operates.

### 12. Children’s privacy

The Extension is not designed to knowingly collect personal information from children.

The developer does not knowingly operate a service that profiles children, targets advertisements to children, or collects children’s personal information through a developer-operated server.

Users must comply with the age requirements and terms of the third-party services they use, including Bilibili and OpenRouter.

### 13. Open-source software

The Extension is distributed as open-source software.

Users and reviewers may inspect the source code to understand how the Extension processes information. Modified or redistributed versions created by third parties are not controlled by the original developer and may follow different privacy practices.

This Privacy Policy applies only to the official version published by the project maintainer.

### 14. Changes to this Privacy Policy

This Privacy Policy may be updated when:

* New features are introduced
* Browser permissions change
* Data-processing behaviour changes
* Third-party services change
* Legal or store-policy requirements change

Material changes will be documented in this file, the project repository, release notes, or the Extension’s store listing.

The “Last updated” date at the top of this document indicates the latest revision.

### 15. Contact

Questions, privacy concerns, and data-handling reports may be submitted through the **Issues** page of the official GitHub repository.

Do not include API keys, account passwords, authentication tokens, private video information, or other sensitive information in a public GitHub issue.

Security-sensitive reports should follow the instructions in the repository’s `SECURITY.md` file, if available.

---

## 中文

### 1. 概述

Bilibili Watch Later Organizer（以下简称“本扩展”）是一款独立开发的开源浏览器扩展，用于帮助用户通过分类目录、关键词规则、批量管理和可选的 AI 辅助分类功能，整理哔哩哔哩稍后再看列表中的视频。

本扩展并非由哔哩哔哩、Microsoft、OpenRouter 或其关联方开发、认可、赞助或运营。

本隐私政策说明本扩展会访问哪些信息、如何使用这些信息、信息存储在哪里，以及用户如何删除相关数据。

### 2. 本扩展访问的信息

为了提供基本功能，本扩展可能会访问受支持的哔哩哔哩页面中显示的信息，包括：

* 视频标题
* 视频标识符或链接
* 稍后再看列表中的视频条目
* 显示扩展界面所需的页面结构和页面状态
* 用户创建的分类、选择状态和整理操作

这些信息仅用于提供视频分类、分类目录管理和批量管理功能。

本扩展不会尝试访问用户的哔哩哔哩密码、支付信息、私信或与扩展功能无关的浏览内容。

### 3. 浏览器本地存储的信息

本扩展可能在浏览器扩展存储空间中保存以下信息：

* 用户创建的分类和分类结构
* 视频分类结果
* 关键词规则
* 扩展偏好和设置
* 用户自行提供的 OpenRouter API Key
* 用于保持扩展界面和运行状态的信息

这些信息保存在用户的浏览器环境中，不会发送到由扩展开发者运营的服务器。

OpenRouter API Key 仅用于验证用户主动发起的 API 请求。扩展开发者不会接收、收集或访问用户的 API Key。

API Key 属于敏感凭据，用户不应公开分享。

### 4. 可选的 AI 辅助分类

AI 辅助分类功能完全可选。

当用户主动发起 AI 分类操作时，本扩展可能会从用户浏览器直接向 OpenRouter API 发送：

* 用户选择的视频标题
* 可用分类名称或分类结构
* 生成分类结果所需的指令
* 用户自行提供的 OpenRouter API Key，用于请求身份验证

只有在用户主动启动 AI 分类，或明确开启每天、每周、按数量自动分类后，相关信息才会发送给所选服务。自动分类可在后台运行；关闭自动分类并删除保存的密钥可停止后续自动请求。

相关信息仅用于生成视频分类建议或分类目录建议。

发送给 OpenRouter 的请求受 OpenRouter 自身的服务条款、隐私政策、安全措施和数据保留政策约束。用户应当在启用 AI 功能前自行阅读相关政策。

扩展开发者无法控制 OpenRouter 如何处理通过其 API 提交的信息。

### 5. 开发者服务器

本扩展不使用由开发者运营的服务器收集或处理用户信息。

本扩展使用的数据仅会：

* 在用户浏览器本地处理；或者
* 在用户主动启用 AI 功能时，由用户浏览器直接发送至 OpenRouter。

扩展开发者不会收到用户的视频标题、分类数据、API Key、浏览活动或分类结果的副本。

### 6. 分析、广告和追踪

本扩展不包含：

* 广告
* 行为追踪
* 第三方分析工具
* 使用情况遥测
* 浏览器指纹识别
* 数据经纪服务
* 加密货币挖矿
* 用户信息出售或出租

本扩展不会出售、出租或交易用户信息。

本扩展不会将用户信息用于信用评估、保险资格判断、就业决定、定向广告或其他与扩展功能无关的用途。

### 7. 浏览器权限

本扩展仅申请实现已声明功能所必需的浏览器权限。

根据实际发布版本，这些权限可能包括：

* 浏览器扩展存储权限，用于保存分类和设置
* 受支持的哔哩哔哩页面访问权限，用于显示和管理稍后再看条目
* 当前标签页权限，用于响应用户主动发起的扩展操作
* OpenRouter API 地址访问权限，用于执行用户主动发起的 AI 分类

本扩展不会使用这些权限监控其他无关网站或用户的其他浏览活动。

### 8. 数据保留期限

本地保存的信息会一直保留在浏览器扩展存储空间中，直至发生以下任一情况：

* 用户通过扩展删除相关信息
* 用户重置扩展
* 用户清除扩展的浏览器存储
* 用户卸载扩展
* 浏览器移除相关存储信息

扩展开发者不会另外保存这些本地数据的副本。

发送给 OpenRouter 的信息可能会按照 OpenRouter 的账户设置、服务条款、模型提供商政策和隐私政策进行保留。

### 9. 删除用户信息

用户可以通过以下方式随时停止使用 AI 功能：

* 不配置 OpenRouter API Key
* 删除已经保存的 OpenRouter API Key
* 不执行 AI 分类操作
* 仅使用本地关键词分类和批量管理功能

用户可以通过以下方式删除扩展在本地保存的信息：

* 使用扩展中提供的重置或清除数据功能
* 删除保存的分类、规则、设置或 API 凭据
* 通过浏览器设置清除扩展存储
* 卸载本扩展

卸载扩展后，浏览器通常会删除该扩展在本地保存的数据。

用户如需使 OpenRouter API Key 立即失效，还应在 OpenRouter 账户中撤销或删除该 Key。

### 10. 数据安全

本扩展以减少数据传输为设计原则，主要配置和分类数据保存在用户浏览器中。

但是，任何浏览器扩展、本地存储机制、网络连接或第三方 API 都无法保证绝对安全。

用户有责任：

* 保护自己的浏览器配置文件和设备
* 对 API Key 保密
* 检查扩展申请的权限
* 在 API Key 可能泄露时及时撤销
* 及时更新浏览器和扩展

用户不应在共享设备或不受信任的设备上输入 API Key。

### 11. 第三方网站和服务

本扩展运行于哔哩哔哩页面，并可能在用户主动启用 AI 功能时与 OpenRouter 通信。

扩展开发者不对第三方网站、API、模型提供商或浏览器平台的隐私政策、安全性、可用性、内容或数据处理行为负责。

哔哩哔哩、OpenRouter、Microsoft Edge、Chromium 或其他第三方的变更可能影响本扩展的运行。

### 12. 儿童隐私

本扩展的设计目的不是主动收集儿童的个人信息。

开发者不会通过自有服务器建立儿童画像、向儿童投放定向广告，或主动收集儿童个人信息。

用户必须遵守其所使用第三方服务的年龄要求和服务条款，包括哔哩哔哩和 OpenRouter。

### 13. 开源软件

本扩展以开源软件形式发布。

用户和审核人员可以检查源代码，了解本扩展如何处理信息。第三方修改或重新分发的版本不受原开发者控制，可能采用不同的数据处理和隐私政策。

本隐私政策仅适用于由项目维护者发布的官方版本。

### 14. 隐私政策变更

在以下情况下，本隐私政策可能会更新：

* 增加新功能
* 浏览器权限发生变化
* 数据处理方式发生变化
* 第三方服务发生变化
* 法律或扩展商店政策要求发生变化

重要变更将通过本文件、项目仓库、版本发布说明或扩展商店页面进行说明。

本文件顶部的“最后更新日期”表示最新修订时间。

### 15. 联系方式

用户可以通过官方 GitHub 仓库的 **Issues** 页面提交隐私问题、数据处理疑问或相关报告。

请勿在公开 GitHub Issue 中提交 API Key、账户密码、身份验证令牌、私人视频信息或其他敏感信息。

涉及安全漏洞或其他敏感问题时，请按照仓库中 `SECURITY.md` 文件提供的方式联系项目维护者。
