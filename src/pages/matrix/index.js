import React from "react";
import * as datGui from "dat.gui";

const Matrix = () => {
  React.useEffect(() => {
    let mounted = true;
    let interval;
    if (mounted) {
      const state = {
        fps: 60,
        color: "#0f0",
        charset: "0123456789ABCDEF",
      };
      const gui = new datGui.GUI();
      const fpsCtrl = gui
        .add(state, "fps")
        .min(1)
        .max(120)
        .step(1);
      gui.addColor(state, "color");
      gui.hide();

      const canvas = document.getElementById("canvas");
      const ctx = canvas.getContext("2d");

      let w, h, p;
      const resize = () => {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;

        p = Array(Math.ceil(w / 10)).fill(0);
      };
      window.addEventListener("resize", resize);
      resize();
      document.querySelector("body").classList.add("matrix");
      const random = (items) => items[Math.floor(Math.random() * items.length)];

      const draw = () => {
        ctx.fillStyle = "rgba(0,0,0,.05)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = state.color;

        for (let i = 0; i < p.length; i++) {
          let v = p[i];
          ctx.fillText(random(state.charset), i * 10, v);
          p[i] = v >= h || v >= 10000 * Math.random() ? 0 : v + 10;
        }
      };

      let interval = setInterval(draw, 1000 / state.fps);
      fpsCtrl.onFinishChange((fps) => {
        console.log(fps);
        if (interval) {
          clearInterval(interval);
        }
        interval = setInterval(draw, 1000 / fps);
      });
    }
    return () => {
      document.querySelector("body").classList.remove("matrix");
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return <canvas id="canvas"></canvas>;
};

export default Matrix;