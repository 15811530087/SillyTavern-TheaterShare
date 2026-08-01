# 小剧场分享（前端扩展）

扩展入口位于聊天输入框旁的魔法棒扩展菜单中，与“打开数据库”和“附加文件”排列在一起。
扩展设置页仍提供分享服务器地址和快捷打开按钮。扩展可在 SillyTavern 的扩展管理界面中启用或禁用。

- 浏览当前分享服务器的公开作品广场
- 上传 TXT、Markdown、HTML 或 JSON 小剧场
- 生成并复制分享链接
- 粘贴其他酒馆的分享链接读取作品
- 将作品保存到本地收藏
- 使用本机保存的删除凭证删除自己上传的内容

HTML 作品通过不带 `allow-same-origin` 权限的 iframe 沙箱预览，不能访问酒馆页面。
公开分享页也通过隔离 iframe 加载，因此不会受到分享端登录页和浏览器 CORS 的阻挡。

该扩展需要分享服务器安装并启用 `plugins/theater-share` 服务端插件。

## 通过“安装扩展”安装

本目录本身就是可安装的前端扩展仓库结构。发布到 GitHub/GitLab 等 Git 服务后，玩家可在
SillyTavern 的“扩展 → 安装扩展”中粘贴仓库的 HTTPS 地址，例如：

```text
https://github.com/15811530087/SillyTavern-TheaterShare
```

前端扩展仓库根目录必须直接包含 `manifest.json`、`index.js` 和 `style.css`，不能在仓库外面
再套一层目录。服务端插件不随前端自动安装，仍需分享服务器管理员部署。
