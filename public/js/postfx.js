// Fullscreen post-process for the final red chase: an extremely strong red tint and a dark vignette.
// It is bypassed entirely (direct render) when the effect is off.
import * as THREE from 'three';

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.amount = 0;
    this.target = 0;
    this.flash = 0;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { magFilter: THREE.NearestFilter, minFilter: THREE.LinearFilter });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rt.texture }, time: { value: 0 }, amount: { value: 0 }, flash: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float time; uniform float amount; uniform float flash;
        varying vec2 vUv;
        void main(){
          // no more hallucination warping: just a hard, extremely red screen
          float a = amount;
          vec3 col = texture2D(tDiffuse, vUv).rgb;
          float lum = dot(col, vec3(0.3, 0.59, 0.11));
          vec3 red = vec3(0.18 + lum * 1.25, lum * 0.015, lum * 0.01);
          col = mix(col, red, 0.97 * a);
          float vig = smoothstep(1.0, 0.3, length(vUv - 0.5));
          col *= mix(1.0, 0.45 + 0.55 * vig, a);
          col = mix(col, vec3(1.0, 0.1, 0.05), flash);
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  setSize(w, h) { this.rt.setSize(Math.max(1, w), Math.max(1, h)); }

  render(scene, camera, dt, time) {
    this.amount += (this.target - this.amount) * Math.min(1, dt * 1.5);
    this.flash = Math.max(0, this.flash - dt * 2);
    if (this.amount < 0.01 && this.flash <= 0) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.mat.uniforms.time.value = time;
    this.mat.uniforms.amount.value = this.amount;
    this.mat.uniforms.flash.value = this.flash * 0.6;
    this.renderer.render(this.scene, this.cam);
  }
}
