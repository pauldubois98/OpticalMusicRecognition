// The model files inside the Android / iOS app (the app build, VITE_APP,
// copies only these): the fast detector and the page finder. The others
// (the high-accuracy detector) are downloaded in the app, from
// VITE_EXTRA_MODELS_URL, when the user asks for them.
export const BUNDLED_MODELS = [
	"copista-meta.json",
	"copista-evidence.onnx",
	"copista-2m-trunk.onnx",
	"copista-2m-verifier.onnx",
	"docaligner-lcnet100.onnx",
];
