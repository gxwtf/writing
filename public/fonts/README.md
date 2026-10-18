# PDF 字体目录

PDF 导出使用以下字体（**版权字体，不纳入 git**，部署时拷贝）：

- `simsun.ttf` — 中文正文（SimSun）
- `times.ttf` — 英文正文（Times New Roman）
- `timesbd.ttf` — 英文粗体（Times New Roman Bold）

部署时从服务器已有项目拷贝：

```bash
mkdir -p public/fonts
cp ~/gxwtf_english/public/fonts/{simsun.ttf,times.ttf,timesbd.ttf} public/fonts/
```

若缺少字体，PDF 导出会在浏览器端报「字体加载失败」。
