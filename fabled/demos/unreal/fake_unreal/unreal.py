"""FAKE `unreal` module. A TEST DOUBLE, NOT UNREAL ENGINE.

Used only by ../../tools/test_unreal_scripts.py, which puts this folder on sys.path so that `import unreal` in
build_sequence_from_shotlist.py and blockout_from_layout.py resolves here. It models the handful of classes those two
scripts touch, records what they do (bindings, tracks, sections, channels, keys, actors, folders, tags, assets) and
lets the tests assert on the result.

What it is good for: proving the scripts' own logic and data flow.
What it cannot tell you: whether the real engine has these functions, with these names, argument orders and
behaviours. Every signature here was written from memory of the UE 5.x Python API without access to an editor or
to Epic's documentation, i.e. it encodes the same assumptions as the scripts. When a real run disagrees with this
file, the engine is right: fix the script, then update this file to match what was observed.

Deliberately stricter than Unreal in a few places, to pin conventions the scripts rely on:
  * `Rotator` only accepts keywords (the real positional order is roll, pitch, yaw, an easy mistake).
  * `set_range`, `set_start_frame`, `set_playback_start` ... take plain ints (display-rate frames), not FrameNumber.
  * `add_key` needs an `unreal.FrameNumber` and a float (or bool on bool channels).

`reset(**config)` starts a fresh fake editor; `STATE` holds everything recorded since. Config keys:
  engine_version, command_line, has_world, sequencer_ui,
  create_camera_result ("binding,actor" | "actor,binding" | "binding" | "actor"),
  camera_default_tracks (child CameraComponent binding with CurrentFocalLength etc.),
  lifetime_track ("spawn" | "binding_lifetime" | "none"), camera_cut_per_call (create_camera adds a camera cut
  section on every call instead of only the first), channel_names, player_start_half_height,
  cancel_after (ScopedSlowTask.should_cancel() turns True after N progress frames), fail_delete.
"""
import itertools
import math

__fabled_fake__ = True

DEFAULTS = dict(
    engine_version="5.8.2-00000000+++UE5+Release-5.8", command_line="", has_world=True, sequencer_ui=True,
    create_camera_result="binding,actor", camera_default_tracks=True, lifetime_track="spawn", channel_names=True,
    player_start_half_height=92.0, cancel_after=None, fail_delete=False, camera_cut_per_call=False,
)


class _State:
    def __init__(self, config):
        unknown = set(config) - set(DEFAULTS)
        if unknown:
            raise TypeError(f"fake unreal: unknown config {sorted(unknown)}")
        self.config = dict(DEFAULTS, **config)
        self.assets = {}            # content path -> asset object
        self.actors = []            # actors in the fake level
        self.destroyed = []         # actors removed with destroy_actor
        self.logs = []              # (level, message)
        self.calls = []             # (function name, args) for the calls tests care about
        self.transactions = []      # ScopedEditorTransaction descriptions
        self.slow_tasks = []        # ScopedSlowTask instances
        self.saved = []             # asset paths passed to save_loaded_asset
        self.deleted_assets = []
        self.open_sequence = None   # the sequence focused in the fake Sequencer
        self.maps = set()
        self.loaded_map = None
        self.level_saves = 0
        self.subsystems = {}
        self.guids = itertools.count(1)
        self.assets["/Engine/BasicShapes/Cube"] = StaticMesh("/Engine/BasicShapes/Cube")

    def record(self, name, *args):
        self.calls.append((name, args))

    def messages(self, level=None):
        return [m for lvl, m in self.logs if level is None or lvl == level]


STATE = None


def reset(**config):
    global STATE
    STATE = _State(config)
    return STATE


def _asset_key(path):
    return str(path).split(".")[0]


def add_static_mesh(path):
    """Test helper: pretend a Static Mesh asset exists at this content path."""
    mesh = StaticMesh(_asset_key(path))
    STATE.assets[_asset_key(path)] = mesh
    return mesh


def add_asset(path, asset):
    STATE.assets[_asset_key(path)] = asset
    return asset


# ----------------------------------------------------------------------------------------------- basics

def log(message):
    STATE.logs.append(("log", str(message)))


def log_warning(message):
    STATE.logs.append(("warning", str(message)))


def log_error(message):
    STATE.logs.append(("error", str(message)))


def _num(value, what):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"fake unreal: {what} must be a number, got {type(value).__name__}")
    return float(value)


def _int(value, what):
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"fake unreal: {what} must be an int (display-rate frames), got {type(value).__name__}")
    return value


class Name:
    def __init__(self, value="None"):
        self._value = str(value)

    def __str__(self):
        return self._value

    def __repr__(self):
        return f"Name({self._value!r})"

    def __eq__(self, other):
        return isinstance(other, (Name, str)) and str(other) == self._value

    def __hash__(self):
        return hash(self._value)


class Text(Name):
    pass


class Vector:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = _num(x, "Vector.x"), _num(y, "Vector.y"), _num(z, "Vector.z")

    def __repr__(self):
        return f"Vector({self.x:g}, {self.y:g}, {self.z:g})"


class Rotator:
    def __init__(self, *args, roll=0.0, pitch=0.0, yaw=0.0):
        if args:
            raise TypeError("fake unreal: build Rotator with keywords (roll=, pitch=, yaw=); the real positional "
                            "order is roll, pitch, yaw")
        self.roll, self.pitch, self.yaw = _num(roll, "roll"), _num(pitch, "pitch"), _num(yaw, "yaw")

    def __repr__(self):
        return f"Rotator(roll={self.roll:g}, pitch={self.pitch:g}, yaw={self.yaw:g})"


class FrameNumber:
    def __init__(self, value=0):
        self.value = _int(value, "FrameNumber.value")


class FrameTime:
    def __init__(self, frame_number):
        self.frame_number = frame_number
        self.sub_frame = 0.0


class FrameRate:
    def __init__(self, numerator=60000, denominator=1):
        self.numerator, self.denominator = _int(numerator, "numerator"), _int(denominator, "denominator")


class Guid:
    def __init__(self, value=0):
        self._value = value

    def to_string(self):
        return f"{self._value:032X}"

    def is_valid(self):
        return self._value != 0

    def __eq__(self, other):
        return isinstance(other, Guid) and other._value == self._value

    def __hash__(self):
        return hash(self._value)

    def __repr__(self):  # like the real struct repr, it is not stable enough to compare on
        return f"<Struct 'Guid' ({hex(id(self))})>"


class _Enum:
    def __init__(self, name):
        self.name = name

    def __repr__(self):
        return self.name


class MovieSceneTimeUnit:
    DISPLAY_RATE = _Enum("MovieSceneTimeUnit.DISPLAY_RATE")
    TICK_RESOLUTION = _Enum("MovieSceneTimeUnit.TICK_RESOLUTION")


class MovieSceneKeyInterpolation:
    AUTO = _Enum("MovieSceneKeyInterpolation.AUTO")
    LINEAR = _Enum("MovieSceneKeyInterpolation.LINEAR")
    CONSTANT = _Enum("MovieSceneKeyInterpolation.CONSTANT")


class MovieSceneObjectBindingSpace:
    LOCAL = _Enum("MovieSceneObjectBindingSpace.LOCAL")
    ROOT = _Enum("MovieSceneObjectBindingSpace.ROOT")


class MovieSceneObjectBindingID:
    def __init__(self):
        self.guid = Guid(0)

    def set_editor_property(self, name, value):
        if name != "guid" or not isinstance(value, Guid):
            raise ValueError(f"fake unreal: MovieSceneObjectBindingID has no settable property {name!r} of that type")
        self.guid = value

    def get_editor_property(self, name):
        if name != "guid":
            raise ValueError(f"fake unreal: MovieSceneObjectBindingID has no property {name!r}")
        return self.guid


class MathLibrary:
    @staticmethod
    def find_look_at_rotation(start, target):
        """FVector::Rotation() of (target - start): yaw = atan2(Y, X), pitch = atan2(Z, |XY|), roll = 0."""
        dx, dy, dz = target.x - start.x, target.y - start.y, target.z - start.z
        return Rotator(roll=0.0, pitch=math.degrees(math.atan2(dz, math.hypot(dx, dy))), yaw=math.degrees(math.atan2(dy, dx)))


class SystemLibrary:
    @staticmethod
    def get_engine_version():
        return STATE.config["engine_version"]

    @staticmethod
    def get_command_line():
        return STATE.config["command_line"]

    @staticmethod
    def collect_garbage():
        STATE.record("collect_garbage")


class ScopedEditorTransaction:
    def __init__(self, desc):
        self.desc = str(desc)
        self.open = False

    def __enter__(self):
        self.open = True
        STATE.transactions.append(self)
        return self

    def __exit__(self, *exc):
        self.open = False
        return False


class ScopedSlowTask:
    def __init__(self, work, desc="", enabled=True):
        self.work, self.desc, self.frames, self.dialog = float(work), str(desc), [], False

    def __enter__(self):
        STATE.slow_tasks.append(self)
        return self

    def __exit__(self, *exc):
        return False

    def make_dialog(self, can_cancel=False, allow_in_pie=False):
        self.dialog = True

    def enter_progress_frame(self, work=1.0, desc=""):
        self.frames.append(str(desc))

    def should_cancel(self):
        limit = STATE.config["cancel_after"]
        return limit is not None and len(self.frames) >= limit


# ----------------------------------------------------------------------------------------------- objects, assets

class _Object:
    _PROPS = ()

    def set_editor_property(self, name, value):
        if name not in self._PROPS:
            raise ValueError(f"fake unreal: {type(self).__name__} has no editor property {name!r}")
        setattr(self, name, value)

    def get_editor_property(self, name):
        if name not in self._PROPS:
            raise ValueError(f"fake unreal: {type(self).__name__} has no editor property {name!r}")
        return getattr(self, name)


class _Asset(_Object):
    def __init__(self, path):
        self._path = _asset_key(path)

    def get_name(self):
        return self._path.rsplit("/", 1)[-1]

    def get_path_name(self):
        return f"{self._path}.{self.get_name()}"


class StaticMesh(_Asset):
    pass


class SkeletalMesh(_Asset):
    pass


class Material(_Asset):
    pass


class EditorAssetLibrary:
    @staticmethod
    def does_asset_exist(path):
        return _asset_key(path) in STATE.assets

    @staticmethod
    def load_asset(path):
        return STATE.assets.get(_asset_key(path))

    @staticmethod
    def delete_asset(path):
        STATE.record("delete_asset", _asset_key(path))
        if STATE.config["fail_delete"] or _asset_key(path) not in STATE.assets:
            return False
        asset = STATE.assets.pop(_asset_key(path))
        STATE.deleted_assets.append(_asset_key(path))
        if STATE.open_sequence is asset:
            STATE.open_sequence = None
        return True

    @staticmethod
    def save_loaded_asset(asset, only_if_is_dirty=True):
        STATE.saved.append(asset._path)
        return True


class LevelSequenceFactoryNew:
    pass


class _AssetTools:
    def create_asset(self, asset_name, package_path, asset_class, factory):
        path = f"{package_path}/{asset_name}"
        STATE.record("create_asset", path)
        if path in STATE.assets:  # the real editor would prompt or fail; never a silent second asset
            return None
        if asset_class is not LevelSequence or not isinstance(factory, LevelSequenceFactoryNew):
            raise TypeError("fake unreal: create_asset only models LevelSequence + LevelSequenceFactoryNew")
        asset = LevelSequence(path)
        STATE.assets[path] = asset
        return asset


class AssetToolsHelpers:
    @staticmethod
    def get_asset_tools():
        return _AssetTools()


# ----------------------------------------------------------------------------------------------- level actors

class _Component(_Object):
    pass


class StaticMeshComponent(_Component):
    _PROPS = ("static_mesh",)

    def __init__(self):
        self.static_mesh = None
        self.mobility = "STATIC"

    def set_static_mesh(self, new_mesh):
        if not isinstance(new_mesh, StaticMesh):
            raise TypeError("fake unreal: set_static_mesh needs a StaticMesh")
        changed = new_mesh is not self.static_mesh
        self.static_mesh = new_mesh
        return changed


class CapsuleComponent(_Component):
    def __init__(self, half_height):
        self._half_height = half_height

    def get_scaled_capsule_half_height(self):
        return self._half_height


class CineCameraComponent(_Component):
    _PROPS = ("current_focal_length",)

    def __init__(self):
        self.current_focal_length = 35.0

    def set_current_focal_length(self, value):
        self.current_focal_length = _num(value, "focal length")


class Actor(_Object):
    _PROPS = ("tags",)

    def __init__(self, location=None, rotation=None):
        self._location = location or Vector()
        self._rotation = rotation or Rotator()
        self._scale = Vector(1.0, 1.0, 1.0)
        self._label = type(self).__name__
        self._folder = Name("None")
        self._tags = []
        self._components = []

    @property
    def tags(self):
        return list(self._tags)  # a copy: mutating it in place does not reach the actor, use set_editor_property

    @tags.setter
    def tags(self, value):
        if not all(isinstance(tag, Name) for tag in value):
            raise TypeError("fake unreal: actor tags must be unreal.Name values")
        self._tags = list(value)

    def actor_has_tag(self, tag):
        return any(str(t) == str(tag) for t in self._tags)

    def set_actor_label(self, new_actor_label, mark_dirty=True):
        self._label = str(new_actor_label)

    def get_actor_label(self):
        return self._label

    def set_folder_path(self, new_folder_path):
        self._folder = Name(str(new_folder_path))

    def get_folder_path(self):
        return self._folder

    def get_actor_location(self):
        return self._location

    def get_actor_rotation(self):
        return self._rotation

    def get_actor_scale3d(self):
        return self._scale

    def set_actor_scale3d(self, new_scale3d):
        if not isinstance(new_scale3d, Vector):
            raise TypeError("fake unreal: set_actor_scale3d needs a Vector")
        self._scale = new_scale3d

    def set_actor_location(self, new_location, sweep, teleport):
        if not isinstance(new_location, Vector):
            raise TypeError("fake unreal: set_actor_location needs a Vector")
        self._location = new_location

    def set_actor_location_and_rotation(self, new_location, new_rotation, sweep, teleport):
        if not isinstance(new_location, Vector) or not isinstance(new_rotation, Rotator):
            raise TypeError("fake unreal: set_actor_location_and_rotation needs a Vector and a Rotator")
        self._location, self._rotation = new_location, new_rotation
        return True

    def get_component_by_class(self, component_class):
        for component in self._components:
            if isinstance(component, component_class):
                return component
        return None


class StaticMeshActor(Actor):
    def __init__(self, location=None, rotation=None):
        super().__init__(location, rotation)
        self.static_mesh_component = StaticMeshComponent()
        self._components.append(self.static_mesh_component)


class PlayerStart(Actor):
    def __init__(self, location=None, rotation=None):
        super().__init__(location, rotation)
        self._components.append(CapsuleComponent(STATE.config["player_start_half_height"]))


class CineCameraActor(Actor):
    def __init__(self, location=None, rotation=None):
        super().__init__(location, rotation)
        self._camera = CineCameraComponent()
        self._components.append(self._camera)

    def get_cine_camera_component(self):
        return self._camera


class _World:
    pass


class EditorActorSubsystem:
    def spawn_actor_from_class(self, actor_class, location, rotation=None, transient=False):
        if not isinstance(location, Vector) or (rotation is not None and not isinstance(rotation, Rotator)):
            raise TypeError("fake unreal: spawn_actor_from_class needs a Vector and a Rotator")
        if not STATE.config["has_world"]:
            return None
        actor = actor_class(location, rotation or Rotator())
        STATE.actors.append(actor)
        STATE.record("spawn_actor_from_class", actor_class.__name__)
        return actor

    def get_all_level_actors(self):
        return list(STATE.actors)

    def destroy_actor(self, actor_to_destroy):
        if actor_to_destroy not in STATE.actors:
            return False
        STATE.actors.remove(actor_to_destroy)
        STATE.destroyed.append(actor_to_destroy)
        return True


class UnrealEditorSubsystem:
    def get_editor_world(self):
        return _World() if STATE.config["has_world"] else None


class LevelEditorSubsystem:
    def load_level(self, asset_path):
        STATE.record("load_level", asset_path)
        if asset_path not in STATE.maps:
            return False
        STATE.loaded_map = asset_path
        STATE.config["has_world"] = True
        return True

    def save_current_level(self):
        STATE.level_saves += 1
        return True


def get_editor_subsystem(subsystem_class):
    if subsystem_class not in (EditorActorSubsystem, UnrealEditorSubsystem, LevelEditorSubsystem, LevelSequenceEditorSubsystem):
        raise TypeError(f"fake unreal: get_editor_subsystem does not model {subsystem_class!r}")
    return STATE.subsystems.setdefault(subsystem_class, subsystem_class())


# ----------------------------------------------------------------------------------------------- sequencer

class _Key:
    def __init__(self, frame, value, time_unit, interpolation):
        self.frame, self.value, self.time_unit, self.interpolation = frame, value, time_unit, interpolation

    def get_time(self, time_unit=MovieSceneTimeUnit.DISPLAY_RATE):
        return FrameTime(FrameNumber(self.frame))

    def get_value(self):
        return self.value


class _Channel(_Object):
    _PROPS = ("channel_name",)
    _value_type = float

    def __init__(self, channel_name):
        self._channel_name = Name(channel_name)
        self._keys = []
        self._default = None

    @property
    def channel_name(self):
        if not STATE.config["channel_names"]:
            raise AttributeError("fake unreal: channel_name disabled by config")
        return self._channel_name

    def get_editor_property(self, name):
        if name != "channel_name" or not STATE.config["channel_names"]:
            raise ValueError(f"fake unreal: no editor property {name!r}")
        return self._channel_name

    def add_key(self, time, new_value, sub_frame=0.0, time_unit=MovieSceneTimeUnit.DISPLAY_RATE,
                interpolation=MovieSceneKeyInterpolation.AUTO):
        if not isinstance(time, FrameNumber):
            raise TypeError("fake unreal: add_key time must be an unreal.FrameNumber")
        if self._value_type is bool:
            if not isinstance(new_value, bool):
                raise TypeError("fake unreal: bool channel add_key needs a bool")
        elif isinstance(new_value, bool) or not isinstance(new_value, float):
            raise TypeError(f"fake unreal: add_key new_value must be a float, got {type(new_value).__name__}")
        if time_unit not in (MovieSceneTimeUnit.DISPLAY_RATE, MovieSceneTimeUnit.TICK_RESOLUTION):
            raise TypeError("fake unreal: add_key time_unit must be a MovieSceneTimeUnit")
        key = _Key(time.value, new_value, time_unit, interpolation)
        self._keys.append(key)
        return key

    def get_keys(self):
        return list(self._keys)

    def remove_key(self, key):
        self._keys.remove(key)

    def set_default(self, value):
        self._default = value

    def has_default(self):
        return self._default is not None

    def get_default(self):
        return self._default


class MovieSceneScriptingDoubleChannel(_Channel):
    pass


class MovieSceneScriptingFloatChannel(_Channel):
    pass


class MovieSceneScriptingBoolChannel(_Channel):
    _value_type = bool


class MovieSceneSection(_Object):
    def __init__(self):
        # like a section fresh from add_section(): bounded and empty until the caller gives it a range
        self._start, self._end = 0, 0
        self._channels = []

    def set_range(self, start_frame, end_frame):
        self._start, self._end = _int(start_frame, "start_frame"), _int(end_frame, "end_frame")

    def set_start_frame(self, start_frame):
        self._start = _int(start_frame, "start_frame")

    def set_end_frame(self, end_frame):
        self._end = _int(end_frame, "end_frame")

    def set_start_frame_bounded(self, is_bounded):
        self._start = (self._start or 0) if is_bounded else None

    def set_end_frame_bounded(self, is_bounded):
        self._end = (self._end or 0) if is_bounded else None

    def has_start_frame(self):
        return self._start is not None

    def has_end_frame(self):
        return self._end is not None

    def get_start_frame(self):
        return self._start

    def get_end_frame(self):
        return self._end

    def get_all_channels(self):
        return list(self._channels)

    def get_channels(self):  # older name, kept by the engine as deprecated
        return list(self._channels)

    def covers(self, start, end):
        """Test helper: is [start, end) inside this section's range?"""
        return (self._start is None or self._start <= start) and (self._end is None or self._end >= end)


class MovieScene3DTransformSection(MovieSceneSection):
    def __init__(self):
        super().__init__()
        names = [f"{group}.{axis}" for group in ("Location", "Rotation", "Scale") for axis in "XYZ"]
        self._channels = [MovieSceneScriptingDoubleChannel(name) for name in names]


class MovieSceneFloatSection(MovieSceneSection):
    def __init__(self):
        super().__init__()
        self._channels = [MovieSceneScriptingFloatChannel("Value")]


class MovieSceneSpawnSection(MovieSceneSection):
    def __init__(self):
        super().__init__()
        channel = MovieSceneScriptingBoolChannel("Spawned")
        channel.set_default(True)
        self._channels = [channel]


class MovieSceneBindingLifetimeSection(MovieSceneSection):
    pass


class MovieSceneCameraCutSection(MovieSceneSection):
    _PROPS = ("camera_binding_id",)

    def __init__(self):
        super().__init__()
        self.camera_binding_id = MovieSceneObjectBindingID()

    def set_camera_binding_id(self, camera_binding_id):
        if not isinstance(camera_binding_id, MovieSceneObjectBindingID):
            raise TypeError("fake unreal: set_camera_binding_id needs a MovieSceneObjectBindingID")
        self.camera_binding_id = camera_binding_id

    def get_camera_binding_id(self):
        return self.camera_binding_id


class MovieSceneTrack(_Object):
    _section_class = MovieSceneSection

    def __init__(self):
        self._sections = []

    def add_section(self):
        section = self._section_class()
        self._sections.append(section)
        return section

    def get_sections(self):
        return list(self._sections)

    def remove_section(self, section):
        self._sections.remove(section)


class _PropertyTrack(MovieSceneTrack):
    def __init__(self):
        super().__init__()
        self._property_name, self._property_path = Name("None"), ""

    def set_property_name_and_path(self, property_name, property_path):
        self._property_name, self._property_path = Name(str(property_name)), str(property_path)

    def get_property_name(self):
        return self._property_name

    def get_property_path(self):
        return self._property_path


class MovieScene3DTransformTrack(_PropertyTrack):
    _section_class = MovieScene3DTransformSection

    def __init__(self):
        super().__init__()
        self._property_name, self._property_path = Name("Transform"), "Transform"


class MovieSceneFloatTrack(_PropertyTrack):
    _section_class = MovieSceneFloatSection


class MovieSceneSpawnTrack(MovieSceneTrack):
    _section_class = MovieSceneSpawnSection


class MovieSceneBindingLifetimeTrack(MovieSceneTrack):
    _section_class = MovieSceneBindingLifetimeSection


class MovieSceneCameraCutTrack(MovieSceneTrack):
    _section_class = MovieSceneCameraCutSection


class _BindingData:
    def __init__(self, guid, name, kind, template=None, bound_object=None):
        self.guid, self.name, self.display_name, self.kind = guid, name, name, kind
        self.parent = None          # guid of the parent binding
        self.tracks = []
        self.template = template    # spawnable object template
        self.bound_object = bound_object


class MovieSceneBindingProxy:
    """Handle to one binding in a sequence (what create_camera / add_possessable return)."""

    def __init__(self, sequence=None, data=None):
        self._sequence, self._data = sequence, data

    def is_valid(self):
        return self._data is not None and self._data.guid in self._sequence._bindings

    def get_id(self):
        return self._data.guid if self._data is not None else Guid(0)

    def get_name(self):
        return self._data.name

    def set_name(self, name):
        self._data.name = str(name)

    def get_display_name(self):
        return Text(self._data.display_name)

    def set_display_name(self, display_name):
        self._data.display_name = str(display_name)

    def get_tracks(self):
        return list(self._data.tracks)

    def find_tracks_by_type(self, track_type):
        return [t for t in self._data.tracks if isinstance(t, track_type)]

    def add_track(self, track_type):
        track = track_type()
        self._data.tracks.append(track)
        return track

    def remove_track(self, track):
        self._data.tracks.remove(track)

    def get_child_possessables(self):
        return [MovieSceneBindingProxy(self._sequence, d) for d in self._sequence._bindings.values() if d.parent == self._data.guid]

    def get_parent(self):
        parent = self._sequence._bindings.get(self._data.parent) if self._data.parent is not None else None
        return MovieSceneBindingProxy(self._sequence, parent)

    def set_parent(self, parent_binding):
        if not parent_binding.is_valid():
            raise ValueError("fake unreal: set_parent needs a valid binding")
        self._data.parent = parent_binding.get_id()

    def get_object_template(self):
        return self._data.template

    def remove(self):
        self._sequence._bindings.pop(self._data.guid, None)


class MovieSceneFolder(_Object):
    def __init__(self, name):
        self._name = str(name)
        self._bindings = []

    def get_folder_name(self):
        return Name(self._name)

    def add_child_object_binding(self, object_binding):
        if not isinstance(object_binding, MovieSceneBindingProxy) or not object_binding.is_valid():
            raise TypeError("fake unreal: add_child_object_binding needs a valid binding")
        self._bindings.append(object_binding.get_id())
        return True

    def get_child_object_bindings(self):
        return list(self._bindings)


class LevelSequence(_Asset):
    def __init__(self, path):
        super().__init__(path)
        self._bindings = {}          # Guid -> _BindingData, in creation order
        self._tracks = []            # sequence-level tracks, including the camera cut track
        self._folders = []
        self._display_rate = FrameRate(30, 1)
        self._playback = [0, 150]    # display-rate frames, end exclusive
        self._view_range = [None, None]
        self._work_range = [None, None]

    # rate and ranges
    def set_display_rate(self, display_rate):
        if not isinstance(display_rate, FrameRate):
            raise TypeError("fake unreal: set_display_rate needs a FrameRate")
        self._display_rate = display_rate

    def get_display_rate(self):
        return self._display_rate

    def set_playback_start(self, start_frame):
        self._playback[0] = _int(start_frame, "start_frame")

    def set_playback_end(self, end_frame):
        self._playback[1] = _int(end_frame, "end_frame")

    def get_playback_start(self):
        return self._playback[0]

    def get_playback_end(self):
        return self._playback[1]

    def set_view_range_start(self, start_time_in_seconds):
        self._view_range[0] = _num(start_time_in_seconds, "seconds")

    def set_view_range_end(self, end_time_in_seconds):
        self._view_range[1] = _num(end_time_in_seconds, "seconds")

    def set_work_range_start(self, start_time_in_seconds):
        self._work_range[0] = _num(start_time_in_seconds, "seconds")

    def set_work_range_end(self, end_time_in_seconds):
        self._work_range[1] = _num(end_time_in_seconds, "seconds")

    # sequence-level tracks (5.2+ names; the 5.0/5.1 "master track" names are not modelled)
    def get_tracks(self):
        return list(self._tracks)

    def find_tracks_by_type(self, track_type):
        return [t for t in self._tracks if isinstance(t, track_type)]

    def add_track(self, track_type):
        if track_type is MovieSceneCameraCutTrack and self.find_tracks_by_type(MovieSceneCameraCutTrack):
            raise RuntimeError("fake unreal: a sequence has only one Camera Cut track")
        track = track_type()
        self._tracks.append(track)
        return track

    def remove_track(self, track):
        self._tracks.remove(track)

    # bindings
    def _new_binding(self, name, kind, **extra):
        data = _BindingData(Guid(next(STATE.guids)), name, kind, **extra)
        self._bindings[data.guid] = data
        return MovieSceneBindingProxy(self, data)

    def get_bindings(self):
        return [MovieSceneBindingProxy(self, d) for d in self._bindings.values()]

    def get_spawnables(self):
        return [MovieSceneBindingProxy(self, d) for d in self._bindings.values() if d.kind == "spawnable"]

    def get_possessables(self):
        return [MovieSceneBindingProxy(self, d) for d in self._bindings.values() if d.kind == "possessable"]

    def add_possessable(self, object_to_possess):
        if not isinstance(object_to_possess, (Actor, _Component)):
            raise TypeError("fake unreal: add_possessable needs an actor or a component")
        STATE.record("add_possessable", type(object_to_possess).__name__)
        name = "CameraComponent" if isinstance(object_to_possess, CineCameraComponent) else type(object_to_possess).__name__
        return self._new_binding(name, "possessable", bound_object=object_to_possess)

    def add_spawnable_from_instance(self, object_to_spawn):
        if not isinstance(object_to_spawn, Actor):
            raise TypeError("fake unreal: add_spawnable_from_instance needs an actor")
        STATE.record("add_spawnable_from_instance", type(object_to_spawn).__name__)
        template = type(object_to_spawn)(object_to_spawn.get_actor_location(), object_to_spawn.get_actor_rotation())
        if isinstance(object_to_spawn, CineCameraActor):
            template.get_cine_camera_component().current_focal_length = object_to_spawn.get_cine_camera_component().current_focal_length
        return self._new_binding(object_to_spawn.get_actor_label(), "spawnable", template=template)

    def add_spawnable_from_class(self, class_to_spawn):
        STATE.record("add_spawnable_from_class", class_to_spawn.__name__)
        return self._new_binding(class_to_spawn.__name__, "spawnable", template=class_to_spawn())

    def get_binding_id(self, binding):
        if not binding.is_valid():
            raise ValueError("fake unreal: get_binding_id needs a valid binding")
        binding_id = MovieSceneObjectBindingID()
        binding_id.guid = binding.get_id()
        return binding_id

    def make_binding_id(self, binding, space=MovieSceneObjectBindingSpace.ROOT):
        return self.get_binding_id(binding)

    # folders
    def add_root_folder_to_sequence(self, new_folder_name):
        folder = MovieSceneFolder(new_folder_name)
        self._folders.append(folder)
        return folder

    def get_root_folders_in_sequence(self):
        return list(self._folders)


class LevelSequenceEditorBlueprintLibrary:
    @staticmethod
    def open_level_sequence(level_sequence):
        STATE.record("open_level_sequence", level_sequence._path)
        if not STATE.config["sequencer_ui"]:
            return False
        STATE.open_sequence = level_sequence
        return True

    @staticmethod
    def get_current_level_sequence():
        return STATE.open_sequence

    @staticmethod
    def close_level_sequence():
        STATE.record("close_level_sequence")
        STATE.open_sequence = None

    @staticmethod
    def refresh_current_level_sequence():
        STATE.record("refresh_current_level_sequence")


class LevelSequenceEditorSubsystem:
    def create_camera(self, spawnable):
        """Models Sequencer's "create camera" as understood from Epic's docs and engine source read in the past:
        a spawnable CineCameraActor binding with a transform track (open-ended section), a Spawned or Binding
        Lifetime track, a child CameraComponent possessable with CurrentFocalLength / ManualFocusDistance /
        CurrentAperture float tracks, and, only when the sequence has no camera cut section yet, a Camera Cut
        section over the playback range bound to this camera."""
        STATE.record("create_camera", spawnable)
        seq = STATE.open_sequence
        if seq is None or not spawnable:
            return MovieSceneBindingProxy(), None
        actor = CineCameraActor()
        binding = seq._new_binding("Cine Camera Actor", "spawnable", template=CineCameraActor())

        transform = binding.add_track(MovieScene3DTransformTrack)
        section = transform.add_section()
        section._start = section._end = None
        style = STATE.config["lifetime_track"]
        if style != "none":
            lifetime = binding.add_track(MovieSceneSpawnTrack if style == "spawn" else MovieSceneBindingLifetimeTrack)
            lifetime_section = lifetime.add_section()
            if style == "spawn":
                lifetime_section._start = lifetime_section._end = None
            else:  # a finite lifetime, so the script has to widen it
                lifetime_section._start, lifetime_section._end = seq._playback[0], seq._playback[0] + 1

        if STATE.config["camera_default_tracks"]:
            component = seq._new_binding("CameraComponent", "possessable", bound_object=actor.get_cine_camera_component())
            component._data.parent = binding.get_id()
            for name, path in (("CurrentFocalLength", "CurrentFocalLength"),
                               ("ManualFocusDistance", "FocusSettings.ManualFocusDistance"),
                               ("CurrentAperture", "CurrentAperture")):
                track = component.add_track(MovieSceneFloatTrack)
                track.set_property_name_and_path(name, path)
                prop_section = track.add_section()
                prop_section._start = prop_section._end = None

        cut_tracks = seq.find_tracks_by_type(MovieSceneCameraCutTrack)
        cut_track = cut_tracks[0] if cut_tracks else seq.add_track(MovieSceneCameraCutTrack)
        if not cut_track.get_sections() or STATE.config["camera_cut_per_call"]:
            cut = cut_track.add_section()
            cut.set_range(seq._playback[0], seq._playback[1])
            cut.set_camera_binding_id(seq.get_binding_id(binding))

        shape = STATE.config["create_camera_result"]
        return {"binding,actor": (binding, actor), "actor,binding": (actor, binding), "binding": binding, "actor": actor}[shape]
