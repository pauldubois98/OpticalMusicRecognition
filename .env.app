# The Android / iOS app build (`vite build --mode app`, see npm run build:app)
VITE_APP=1
# The models not inside the app (see src/pipeline/bundled.js), pinned to a
# commit of the model repo so that they match the app's copista-meta.json
VITE_EXTRA_MODELS_URL=https://huggingface.co/pauldubois98/musicocr-models/resolve/049d45cf85545b169392bc4376b7cf0570408f44/
