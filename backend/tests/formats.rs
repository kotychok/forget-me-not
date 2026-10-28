use forget_me_not::{
    Document, Item,
    portable::Portable,
    transfer::{self, Format},
};
use uuid::Uuid;
fn item(text: &str, kind: &str, completed: bool, children: Vec<Item>) -> Item {
    Item {
        note: String::new(),
        tags: vec![],
        due_date: None,
        id: Uuid::new_v4().to_string(),
        text: text.into(),
        kind: kind.into(),
        completed,
        children,
    }
}
fn normalized(value: &Portable) -> serde_json::Value {
    fn clean(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::Object(map) => {
                map.remove("id");
                for v in map.values_mut() {
                    clean(v);
                }
            }
            serde_json::Value::Array(values) => {
                for v in values {
                    clean(v);
                }
            }
            _ => {}
        }
    }
    let mut v = serde_json::to_value(value).unwrap();
    clean(&mut v);
    v
}
#[test]
fn agreed_prose_example_has_six_roots_and_one_task() {
    let source = "# demo #\n\n[ ] Item\n\n- Item\n- Item 2\n\nItem\n\n- Item\n- item 2\n";
    let decoded = transfer::decode(Format::Markdown, source).unwrap();
    let list = &decoded.document.lists[0];
    assert_eq!(list.title, "demo");
    assert_eq!(list.nodes.len(), 6);
    assert_eq!(list.nodes[0].kind, "task");
    assert!(!list.nodes[0].completed);
    assert!(list.nodes.iter().all(|i| i.children.is_empty()));
    assert!(list.nodes[1..].iter().all(|i| i.kind == "item"));
}
#[test]
fn nested_markers_tasks_and_additional_headings_are_explicit() {
    let source = "# Title\n\nRoot\n\n- Child sibling\n   1. [x] Done\n      - Nested\n   - Plain\n\n## Other\n";
    let result = transfer::decode(Format::Markdown, source).unwrap();
    let list = &result.document.lists[0];
    assert_eq!(list.nodes.len(), 3);
    assert!(list.nodes[1].children[0].completed);
    assert_eq!(list.nodes[1].children[0].children[0].text, "Nested");
    assert_eq!(list.nodes[2].text, "## Other");
    assert_eq!(result.warnings.len(), 2);
}
#[test]
fn markdown_round_trip_preserves_literal_content_multiline_empty_items_and_structure() {
    let source = Portable {
        schema_version: 4,
        lists: vec![Document {
            id: Uuid::new_v4().to_string(),
            title: "Title #".into(),
            nodes: vec![
                item(
                    "[ ] literal\n- not a child\n1. not numbered\n  leading spaces\n  - literal indented bullet\n  1. literal indented number\n   \n\ntrailing\n",
                    "item",
                    false,
                    vec![item(
                        "**bold** <html> C:\\Work https://example.org/a_(b)",
                        "task",
                        true,
                        vec![],
                    )],
                ),
                item("", "item", false, vec![]),
                item("", "task", false, vec![]),
            ],
        }],
    };
    let encoded = transfer::encode(Format::Markdown, &source).unwrap();
    let decoded = transfer::decode(Format::Markdown, &encoded.text).unwrap();
    assert_eq!(normalized(&source), normalized(&decoded.document));
    let json = transfer::encode(Format::Json, &source).unwrap();
    assert_eq!(
        serde_json::to_value(source).unwrap(),
        serde_json::to_value(transfer::decode(Format::Json, &json.text).unwrap().document).unwrap()
    );
}
#[test]
fn limits_unsupported_constructs_and_nonportable_export_fail_explicitly() {
    for text in [
        "# T\n\n```rust\ncode\n```",
        "# T\n\n   - No parent",
        "# T\n\n- Parent\n\n   prose",
        "\t- tab",
    ] {
        assert!(transfer::decode(Format::Markdown, text).is_err(), "{text}");
    }
    let large = format!("# Large\n\n{}", "- Item\n".repeat(5000));
    assert_eq!(
        transfer::decode(Format::Markdown, &large)
            .unwrap()
            .document
            .lists[0]
            .nodes
            .len(),
        5000
    );
    assert!(transfer::decode(Format::Markdown, &(large + "- Extra\n")).is_err());
    let fixture: Portable =
        serde_json::from_str(include_str!("../../fixtures/portable-v1.json")).unwrap();
    assert!(transfer::encode(Format::Markdown, &fixture).is_err());
}

#[tokio::test]
async fn conversion_endpoints_are_read_only_and_validated_before_persistence() {
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    let dir = tempfile::tempdir().unwrap();
    let store = forget_me_not::Store::open(&dir.path().join("test.sqlite"))
        .await
        .unwrap();
    let application =
        forget_me_not::app(store.clone(), 3001, 5173, std::path::Path::new("missing"));
    let request = |path: &str, value: serde_json::Value| {
        Request::builder()
            .method("POST")
            .uri(path)
            .header("host", "127.0.0.1:3001")
            .header("content-type", "application/json")
            .body(Body::from(value.to_string()))
            .unwrap()
    };
    let response = application
        .clone()
        .oneshot(request(
            "/api/transfer/decode",
            serde_json::json!({"format":"markdown","text":"# Preview\n\n- [x] Task\n   - Child"}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let result: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert!(store.lists().await.unwrap().is_empty());
    let document: Portable = serde_json::from_value(result["document"].clone()).unwrap();
    let copied = store.import_json(document).await.unwrap();
    assert_eq!(
        store.get(&copied[0].id).await.unwrap().nodes[0]
            .children
            .len(),
        1
    );
    let response = application
        .oneshot(request(
            "/api/transfer/encode",
            serde_json::json!({"format":"markdown","document":result["document"]}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(store.lists().await.unwrap().len(), 1);
}
