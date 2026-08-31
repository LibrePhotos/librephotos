"""Characterization tests for service/image_captioning/api/im2txt/train.py::main.

This is the im2txt *training* script. It is never imported by the Django app
(its ``from api.im2txt...`` imports do not even resolve inside this repo, where
``api`` is the Django app package), so the module is loaded here by file path
with ``api.im2txt.data_loader`` / ``api.im2txt.model`` stubbed into
``sys.modules``.

Nothing real is trained: the data loader, the encoder/decoder, the loss, the
optimizer, ``torch.optim``/``torch.save`` and ``pack_padded_sequence`` are all
fakes. No model files, no network, no CUDA.

Behaviour pinned here (current, not aspirational):
  * ``model_path`` is created only when it does not already exist.
  * The vocabulary is unpickled from ``vocab_path`` opened in ``"rb"``; the
    resulting object is passed straight to ``get_loader`` and its ``len()`` is
    the decoder's vocab size.
  * ``get_loader`` is called positionally with the module constants plus
    ``shuffle=True`` and ``num_workers``.
  * Optimizer params are ``decoder.parameters() + encoder.linear.parameters()
    + encoder.bn.parameters()`` -- note the encoder's *other* parameters
    (the pretrained resnet) are deliberately excluded.
  * The training loop runs ``num_epochs`` full passes; per step it calls
    ``pack_padded_sequence(captions, lengths, batch_first=True)[0]``, encoder,
    decoder, criterion, ``decoder.zero_grad()``, ``encoder.zero_grad()``,
    ``loss.backward()``, ``optimizer.step()`` -- in that order.
  * Logging fires on ``i % log_step == 0`` (so step 0 of every epoch); the
    epoch counter is 0-based while checkpoint filenames are 1-based.
  * Checkpoints are saved on ``(i + 1) % save_step == 0`` as
    ``decoder-{epoch+1}-{i+1}.ckpt`` / ``encoder-{epoch+1}-{i+1}.ckpt``.
  * An empty data loader means zero steps, zero prints, zero saves.
  * Errors from opening/unpickling the vocab propagate out of ``main``.
  * ``main`` returns ``None``.

QUIRK (pinned, not fixed): ``main`` takes no arguments and reads every
hyper-parameter from module-level globals, which is exactly why it is
untestable without this much patching. A refactor that turns those globals
into parameters (with the same defaults) would keep every assertion here
valid if the defaults test below is kept in sync.
"""

import importlib.util
import os
import sys
import types
from unittest.mock import MagicMock, mock_open, patch

from django.test import SimpleTestCase

TRAIN_PATH = os.path.join(
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ),
    "service",
    "image_captioning",
    "api",
    "im2txt",
    "train.py",
)


class _StubNet:
    """Stand-in for EncoderCNN / DecoderRNN as constructed by ``main``."""

    def __init__(self, *args, **kwargs):
        self.init_args = args
        self.init_kwargs = kwargs

    def to(self, device):
        return self


def _load_train_module():
    """Load train.py by path with its unresolvable imports stubbed out."""
    pkg = types.ModuleType("api.im2txt")
    pkg.__path__ = []
    data_loader = types.ModuleType("api.im2txt.data_loader")
    data_loader.get_loader = lambda *a, **k: []
    model = types.ModuleType("api.im2txt.model")
    model.EncoderCNN = _StubNet
    model.DecoderRNN = _StubNet

    names = ("api.im2txt", "api.im2txt.data_loader", "api.im2txt.model")
    saved = {name: sys.modules.get(name) for name in names}
    sys.modules["api.im2txt"] = pkg
    sys.modules["api.im2txt.data_loader"] = data_loader
    sys.modules["api.im2txt.model"] = model
    try:
        spec = importlib.util.spec_from_file_location("im2txt_train_u45", TRAIN_PATH)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    finally:
        for name, old in saved.items():
            if old is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old
    return module


train = _load_train_module()


class FakeTensor:
    """Minimal tensor stand-in: ``.to(device)`` returns itself."""

    def __init__(self, label):
        self.label = label
        self.to_calls = []

    def to(self, device):
        self.to_calls.append(device)
        return self

    def __repr__(self):  # pragma: no cover - debugging aid
        return f"FakeTensor({self.label!r})"


class FakeLoss:
    def __init__(self, value, recorder):
        self.value = value
        self.recorder = recorder

    def backward(self):
        self.recorder.append("backward")

    def item(self):
        return self.value


class FakeNet:
    """Encoder/decoder double recording the call order into a shared list."""

    def __init__(self, name, recorder, output):
        self.name = name
        self.recorder = recorder
        self.output = output
        self.calls = []
        self.linear = MagicMock()
        self.bn = MagicMock()
        self.linear.parameters.return_value = [f"{name}.linear.p"]
        self.bn.parameters.return_value = [f"{name}.bn.p"]
        self._params = [f"{name}.p"]
        self._state = {name: "state"}

    def to(self, device):
        self.device = device
        return self

    def parameters(self):
        return list(self._params)

    def state_dict(self):
        return self._state

    def zero_grad(self):
        self.recorder.append(f"{self.name}.zero_grad")

    def __call__(self, *args):
        self.recorder.append(f"{self.name}.forward")
        self.calls.append(args)
        return self.output


class TrainMainHarness:
    """Wires fakes into the loaded train module for the duration of a test."""

    def __init__(self, testcase, batches, vocab=None, path_exists=True):
        self.recorder = []
        self.batches = batches
        self.vocab = vocab if vocab is not None else ["a", "b", "c"]
        self.path_exists = path_exists

        self.makedirs = MagicMock()
        self.get_loader = MagicMock(return_value=batches)
        self.encoder = FakeNet("encoder", self.recorder, FakeTensor("features"))
        self.decoder = FakeNet("decoder", self.recorder, FakeTensor("outputs"))
        self.encoder_cls = MagicMock(return_value=self.encoder)
        self.decoder_cls = MagicMock(return_value=self.decoder)
        self.criterion = MagicMock(
            side_effect=lambda outputs, targets: FakeLoss(2.0, self.recorder)
        )
        self.optimizer = MagicMock()
        self.optimizer.step.side_effect = lambda: self.recorder.append("opt.step")
        self.adam = MagicMock(return_value=self.optimizer)
        self.torch_save = MagicMock()
        self.pack = MagicMock(side_effect=lambda *a, **k: (FakeTensor("targets"), None))
        self.pickle_load = MagicMock(return_value=self.vocab)

        fake_os = types.SimpleNamespace(
            path=types.SimpleNamespace(
                exists=MagicMock(return_value=path_exists), join=os.path.join
            ),
            makedirs=self.makedirs,
        )
        fake_nn = types.SimpleNamespace(
            CrossEntropyLoss=MagicMock(return_value=self.criterion)
        )
        fake_torch = types.SimpleNamespace(
            optim=types.SimpleNamespace(Adam=self.adam), save=self.torch_save
        )
        fake_pickle = types.SimpleNamespace(load=self.pickle_load)

        self.open_mock = mock_open(read_data=b"")
        self._patchers = [
            patch.object(train, "os", fake_os),
            patch.object(train, "nn", fake_nn),
            patch.object(train, "torch", fake_torch),
            patch.object(train, "pickle", fake_pickle),
            patch.object(train, "get_loader", self.get_loader),
            patch.object(train, "EncoderCNN", self.encoder_cls),
            patch.object(train, "DecoderRNN", self.decoder_cls),
            patch.object(train, "pack_padded_sequence", self.pack),
            patch("builtins.open", self.open_mock),
            patch("builtins.print", MagicMock()),
        ]
        self.print_mock = self._patchers[-1]
        self.fake_os = fake_os

    def __enter__(self):
        self.printer = None
        for p in self._patchers[:-1]:
            p.start()
        self.printer = self._patchers[-1].start()
        return self

    def __exit__(self, *exc):
        for p in self._patchers:
            p.stop()
        return False

    @property
    def printed(self):
        return [call.args[0] for call in self.printer.call_args_list]


def _batch(idx):
    return (FakeTensor(f"images{idx}"), FakeTensor(f"captions{idx}"), [3, 2])


class TrainMainCharacterizationTest(SimpleTestCase):
    def test_module_level_hyperparameters_are_the_pinned_defaults(self):
        self.assertEqual(train.model_path, "api/im2txt/models/")
        self.assertEqual(train.crop_size, 224)
        self.assertEqual(train.vocab_path, "api/im2txt/data/vocab.pkl")
        self.assertEqual(train.image_dir, "api/im2txt/data/resized2014/")
        self.assertEqual(
            train.caption_path, "api/im2txt/data/annotations/captions_train2014.json"
        )
        self.assertEqual(train.log_step, 10)
        self.assertEqual(train.save_step, 1000)
        self.assertEqual(train.embed_size, 256)
        self.assertEqual(train.hidden_size, 512)
        self.assertEqual(train.num_layers, 1)
        self.assertEqual(train.num_epochs, 5)
        self.assertEqual(train.batch_size, 128)
        self.assertEqual(train.num_workers, 2)
        self.assertEqual(train.learning_rate, 0.001)
        self.assertIn(train.device.type, ("cpu", "cuda"))

    # ---- model directory branch --------------------------------------

    def test_creates_model_directory_when_missing(self):
        with (
            patch.object(train, "num_epochs", 0),
            TrainMainHarness(self, [], path_exists=False) as h,
        ):
            train.main()
        h.fake_os.path.exists.assert_called_once_with(train.model_path)
        h.makedirs.assert_called_once_with(train.model_path)

    def test_does_not_create_model_directory_when_present(self):
        with (
            patch.object(train, "num_epochs", 0),
            TrainMainHarness(self, [], path_exists=True) as h,
        ):
            train.main()
        h.makedirs.assert_not_called()

    # ---- setup: vocab, loader, models, optimizer ----------------------

    def test_setup_wiring(self):
        vocab = ["<pad>", "<start>", "<end>", "cat", "dog"]
        with (
            patch.object(train, "num_epochs", 0),
            TrainMainHarness(self, [], vocab=vocab) as h,
        ):
            result = train.main()

        self.assertIsNone(result)

        # vocab is unpickled from vocab_path opened in binary read mode
        h.open_mock.assert_called_once_with(train.vocab_path, "rb")
        self.assertEqual(h.pickle_load.call_count, 1)

        # get_loader gets the raw vocab object plus the module constants
        args, kwargs = h.get_loader.call_args
        self.assertEqual(args[0], train.image_dir)
        self.assertEqual(args[1], train.caption_path)
        self.assertIs(args[2], vocab)
        self.assertEqual(args[4], train.batch_size)
        self.assertEqual(kwargs, {"shuffle": True, "num_workers": train.num_workers})

        # the transform is a torchvision Compose of 4 ops (crop/flip/tensor/norm)
        transform = args[3]
        self.assertEqual(len(transform.transforms), 4)
        self.assertEqual(transform.transforms[0].size, (train.crop_size,) * 2)

        # models built with the module hyper-parameters; decoder vocab size = len(vocab)
        h.encoder_cls.assert_called_once_with(train.embed_size)
        h.decoder_cls.assert_called_once_with(
            train.embed_size, train.hidden_size, len(vocab), train.num_layers
        )

        # optimizer sees decoder params + encoder.linear + encoder.bn ONLY
        adam_args, adam_kwargs = h.adam.call_args
        self.assertEqual(
            adam_args[0], ["decoder.p", "encoder.linear.p", "encoder.bn.p"]
        )
        self.assertEqual(adam_kwargs, {"lr": train.learning_rate})

    def test_vocab_load_error_propagates(self):
        with patch.object(train, "num_epochs", 0), TrainMainHarness(self, []) as h:
            h.pickle_load.side_effect = EOFError("truncated pickle")
            with self.assertRaises(EOFError):
                train.main()
        h.get_loader.assert_not_called()

    # ---- the training loop -------------------------------------------

    def test_step_call_order_and_arguments(self):
        batches = [_batch(0)]
        with patch.object(train, "num_epochs", 1), TrainMainHarness(self, batches) as h:
            train.main()

        self.assertEqual(
            h.recorder,
            [
                "encoder.forward",
                "decoder.forward",
                "decoder.zero_grad",
                "encoder.zero_grad",
                "backward",
                "opt.step",
            ],
        )

        images, captions, lengths = batches[0]
        # both mini-batch tensors are moved to the module device
        self.assertEqual(images.to_calls, [train.device])
        self.assertEqual(captions.to_calls, [train.device])
        # targets come from pack_padded_sequence(...)[0]
        h.pack.assert_called_once_with(captions, lengths, batch_first=True)
        self.assertEqual(h.encoder.calls, [(images,)])
        self.assertEqual(h.decoder.calls[0][1:], (captions, lengths))
        self.assertIs(h.decoder.calls[0][0], h.encoder.output)
        # criterion(outputs, targets)
        crit_args = h.criterion.call_args.args
        self.assertIs(crit_args[0], h.decoder.output)
        self.assertEqual(crit_args[1].label, "targets")

    def test_runs_num_epochs_full_passes(self):
        batches = [_batch(i) for i in range(3)]
        with patch.object(train, "num_epochs", 4), TrainMainHarness(self, batches) as h:
            train.main()

        self.assertEqual(h.optimizer.step.call_count, 12)
        self.assertEqual(h.criterion.call_count, 12)
        # the loader object is iterated once per epoch, not re-created
        self.assertEqual(h.get_loader.call_count, 1)

    def test_empty_data_loader_trains_nothing(self):
        with TrainMainHarness(self, []) as h:
            train.main()
        h.criterion.assert_not_called()
        h.optimizer.step.assert_not_called()
        h.torch_save.assert_not_called()
        self.assertEqual(h.printed, [])

    # ---- logging branch (i % log_step == 0) ---------------------------

    def test_logs_on_first_step_of_each_epoch_and_every_log_step(self):
        batches = [_batch(i) for i in range(12)]
        with (
            patch.object(train, "num_epochs", 2),
            patch.object(train, "log_step", 10),
            TrainMainHarness(self, batches) as h,
        ):
            train.main()

        # i = 0 and i = 10 in each of the 2 epochs
        self.assertEqual(len(h.printed), 4)
        self.assertEqual(
            h.printed[0],
            "Epoch [0/2], Step [0/12], Loss: 2.0000, Perplexity: 7.3891",
        )
        self.assertEqual(
            h.printed[1],
            "Epoch [0/2], Step [10/12], Loss: 2.0000, Perplexity: 7.3891",
        )
        # QUIRK: the epoch counter in the log line is 0-based
        self.assertEqual(
            h.printed[2],
            "Epoch [1/2], Step [0/12], Loss: 2.0000, Perplexity: 7.3891",
        )

    def test_no_logging_when_log_step_does_not_divide(self):
        batches = [_batch(i) for i in range(3)]
        with (
            patch.object(train, "num_epochs", 1),
            patch.object(train, "log_step", 10),
            TrainMainHarness(self, batches) as h,
        ):
            train.main()
        # still logs step 0 (0 % 10 == 0), and nothing else
        self.assertEqual(len(h.printed), 1)

    # ---- checkpoint branch ((i + 1) % save_step == 0) -----------------

    def test_saves_decoder_then_encoder_checkpoints_with_1_based_names(self):
        batches = [_batch(i) for i in range(4)]
        with (
            patch.object(train, "num_epochs", 1),
            patch.object(train, "save_step", 2),
            TrainMainHarness(self, batches) as h,
        ):
            train.main()

        # i = 1 and i = 3 -> two checkpoint pairs
        self.assertEqual(h.torch_save.call_count, 4)
        names = [call.args[1] for call in h.torch_save.call_args_list]
        self.assertEqual(
            names,
            [
                os.path.join(train.model_path, "decoder-1-2.ckpt"),
                os.path.join(train.model_path, "encoder-1-2.ckpt"),
                os.path.join(train.model_path, "decoder-1-4.ckpt"),
                os.path.join(train.model_path, "encoder-1-4.ckpt"),
            ],
        )
        self.assertEqual(h.torch_save.call_args_list[0].args[0], h.decoder.state_dict())
        self.assertEqual(h.torch_save.call_args_list[1].args[0], h.encoder.state_dict())

    def test_no_checkpoint_when_save_step_never_divides(self):
        batches = [_batch(i) for i in range(3)]
        with patch.object(train, "num_epochs", 2), TrainMainHarness(self, batches) as h:
            train.main()
        # default save_step is 1000, far beyond 3 steps
        h.torch_save.assert_not_called()

    def test_checkpoint_epoch_number_is_1_based_across_epochs(self):
        batches = [_batch(i) for i in range(2)]
        with (
            patch.object(train, "num_epochs", 2),
            patch.object(train, "save_step", 2),
            TrainMainHarness(self, batches) as h,
        ):
            train.main()
        names = [call.args[1] for call in h.torch_save.call_args_list]
        self.assertEqual(
            names,
            [
                os.path.join(train.model_path, "decoder-1-2.ckpt"),
                os.path.join(train.model_path, "encoder-1-2.ckpt"),
                os.path.join(train.model_path, "decoder-2-2.ckpt"),
                os.path.join(train.model_path, "encoder-2-2.ckpt"),
            ],
        )

    # ---- error propagation from inside the loop -----------------------

    def test_exception_from_forward_pass_propagates(self):
        batches = [_batch(0), _batch(1)]
        with patch.object(train, "num_epochs", 1), TrainMainHarness(self, batches) as h:
            h.criterion.side_effect = RuntimeError("size mismatch")
            with self.assertRaises(RuntimeError):
                train.main()
        # aborted on the very first step: no optimizer step ever ran
        h.optimizer.step.assert_not_called()
