from flask import Flask, render_template, jsonify, request
from pymongo import MongoClient
from bson import ObjectId
import json
from bson import json_util
from dotenv import load_dotenv
import os

load_dotenv()

app = Flask(__name__)

# MongoDB连接
client = MongoClient(os.getenv('MONGODB_URI', 'mongodb://localhost:27017/'))
db = client['pharmrg']
collection = db['drug_interactions']


def parse_json(data):
    """将MongoDB数据转换为JSON可序列化格式"""
    return json.loads(json_util.dumps(data))


@app.route('/')
def index():
    """主页"""
    return render_template('index.html')


@app.route('/api/suggestions')
def get_suggestions():
    """获取搜索建议"""
    query = request.args.get('q', '').strip()
    search_type = request.args.get('type', 'drug')

    if not query or len(query) < 2:
        return jsonify([])

    suggestions = []
    seen_names = set()

    if search_type == 'drug':
        # 搜索药物名称
        name_matches = collection.find({
            'name': {'$regex': query, '$options': 'i'}
        }).limit(10)

        for drug in name_matches:
            drug_name = drug.get('name', '')
            if drug_name and drug_name not in seen_names:
                seen_names.add(drug_name)
                suggestions.append({
                    'id': str(drug['_id']),
                    'name': drug_name,
                    'matched_field': 'name',
                    'drugbank_ids': drug.get('drugbank_ids', [])[:3],
                    'type': 'drug'
                })

        # 搜索DrugBank IDs
        id_matches = collection.find({
            'drugbank_ids': {'$regex': f'^{query}', '$options': 'i'}
        }).limit(10)

        for drug in id_matches:
            drug_name = drug.get('name', '')
            if drug_name not in seen_names:
                matched_ids = [id for id in drug.get('drugbank_ids', [])
                               if id.lower().startswith(query.lower())]
                if matched_ids:
                    seen_names.add(drug_name)
                    suggestions.append({
                        'id': str(drug['_id']),
                        'name': drug_name,
                        'matched_field': 'drugbank_id',
                        'matched_value': matched_ids[0],
                        'drugbank_ids': drug.get('drugbank_ids', [])[:3],
                        'type': 'drug'
                    })

    return jsonify(suggestions[:10])


@app.route('/api/search')
def search():
    """执行搜索"""
    search_type = request.args.get('type', 'drug')
    query = request.args.get('q', '').strip()

    if not query or len(query) < 2:
        return jsonify([])

    results = []
    seen_names = set()

    if search_type == 'drug':
        # 搜索药物
        drugs = list(collection.find({
            '$or': [
                {'name': {'$regex': query, '$options': 'i'}},
                {'drugbank_ids': {'$regex': query, '$options': 'i'}}
            ]
        }).limit(20))

        for drug in drugs:
            drug_name = drug.get('name', 'Unknown')
            if drug_name not in seen_names:
                seen_names.add(drug_name)
                results.append({
                    'id': str(drug['_id']),
                    'name': drug_name,
                    'drugbank_ids': drug.get('drugbank_ids', []),
                    'type': 'drug',
                    'description': drug.get('description', '')[:100] + '...' if drug.get('description') else ''
                })

    return jsonify(results)


@app.route('/api/drug/<identifier>')
def get_drug(identifier):
    """获取单个药物详情"""
    try:
        drug = None

        # 通过ObjectId
        if ObjectId.is_valid(identifier):
            drug = collection.find_one({'_id': ObjectId(identifier)})

        # 通过drugbank_id
        if not drug:
            drug = collection.find_one({'drugbank_ids': identifier})

        # 通过名称
        if not drug:
            drug = collection.find_one({'name': identifier})

        if drug:
            return jsonify(parse_json(drug))

        return jsonify({'error': 'Drug not found'}), 404

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/graph/<identifier>')
def get_drug_graph(identifier):
    """获取药物的知识图谱数据 - 优化版"""
    try:
        # 获取目标药物
        target_drug = None

        # 通过ObjectId
        if ObjectId.is_valid(identifier):
            target_drug = collection.find_one({'_id': ObjectId(identifier)})

        # 通过drugbank_id
        if not target_drug:
            target_drug = collection.find_one({'drugbank_ids': identifier})

        # 通过名称
        if not target_drug:
            target_drug = collection.find_one({'name': identifier})

        if not target_drug:
            return jsonify({'error': 'Drug not found'}), 404

        print(f"========== 构建知识图谱 - 中心药物: {target_drug.get('name')} ==========")

        # 获取full参数，判断是否显示全部节点
        show_full = request.args.get('full', 'false').lower() == 'true'

        # 构建图谱
        nodes = []
        edges = []
        node_ids = set()

        # 添加中心节点
        center_id = str(target_drug['_id'])
        center_node = {
            'id': center_id,
            'label': target_drug.get('name', 'Unknown'),
            'title': f"名称: {target_drug.get('name')}\nID: {target_drug.get('_id')}",
            'group': 'center',
            'type': 'drug',
            'value': 30
        }
        nodes.append(center_node)
        node_ids.add(center_id)

        # 获取interacts_with数组
        interacts_with = target_drug.get('interacts_with', [])
        total_interactions = len(interacts_with)
        print(f"找到 {total_interactions} 个相互作用关系")

        # 确定要显示的节点数量
        MAX_NODES = 15  # 默认最大节点数
        if show_full:
            MAX_NODES = total_interactions  # 显示全部

        interactions_to_show = interacts_with[:MAX_NODES]

        # 处理每个相互作用
        for idx, interaction in enumerate(interactions_to_show):
            drugbank_id = interaction.get('drugbank_id')
            description = interaction.get('description', '相互作用描述')

            if not drugbank_id:
                continue

            # 查找相关药物
            related_drug = collection.find_one({'drugbank_ids': drugbank_id})

            if related_drug:
                node_id = str(related_drug['_id'])
                node_name = related_drug.get('name', drugbank_id)

                # 如果节点不存在，添加它
                if node_id not in node_ids:
                    node = {
                        'id': node_id,
                        'label': node_name,
                        'title': f"名称: {node_name}\n相互作用: {description}",
                        'group': 'related',
                        'type': 'drug',
                        'value': 20
                    }
                    nodes.append(node)
                    node_ids.add(node_id)

                # 添加边
                edge = {
                    'id': f"edge_{center_id}_{node_id}_{idx}",
                    'from': center_id,
                    'to': node_id,
                    'title': description,
                    'width': 2,
                    'color': '#00bcd4'
                }
                edges.append(edge)

        # 如果不是显示全部且有更多节点，添加"更多"节点
        remaining = total_interactions - len(interactions_to_show)
        if not show_full and remaining > 0:
            more_node_id = f"more_{center_id}"
            more_node = {
                'id': more_node_id,
                'label': f"+{remaining} 更多",
                'title': f"还有 {remaining} 个未显示的相互作用关系\n双击查看全部",
                'group': 'more',
                'type': 'more',
                'value': 10,
                'shape': 'box',
                'color': {
                    'background': '#4a4f5a',
                    'border': '#8a8f99',
                    'highlight': {
                        'background': '#5a5f6a',
                        'border': '#00bcd4'
                    }
                }
            }
            nodes.append(more_node)

            # 添加从中心节点到"更多"节点的边
            more_edge = {
                'id': f"edge_{center_id}_more",
                'from': center_id,
                'to': more_node_id,
                'title': f"点击查看全部 {total_interactions} 个相互作用",
                'width': 1,
                'color': '#8a8f99',
                'dashes': True
            }
            edges.append(more_edge)

        response_data = {
            'nodes': nodes,
            'edges': edges,
            'center_id': center_id,
            'drug_name': target_drug.get('name', 'Unknown'),
            'total_interactions': total_interactions,
            'displayed_interactions': len(edges) - (1 if not show_full and remaining > 0 else 0),
            'has_more': not show_full and remaining > 0,
            'remaining_count': remaining
        }

        print(f"图谱构建完成: {len(nodes)} 个节点, {len(edges)} 条边")
        return jsonify(response_data)

    except Exception as e:
        print(f"Error in get_drug_graph: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/drug/<identifier>/molecular_info')
def get_molecular_info(identifier):
    """获取分子结构信息"""
    try:
        drug = None

        # 通过ObjectId
        if ObjectId.is_valid(identifier):
            drug = collection.find_one({'_id': ObjectId(identifier)})

        # 通过drugbank_id
        if not drug:
            drug = collection.find_one({'drugbank_ids': identifier})

        # 通过名称
        if not drug:
            drug = collection.find_one({'name': identifier})

        if drug:
            molecular_info = {
                'name': drug.get('name', ''),
                'drugbank_ids': drug.get('drugbank_ids', []),
                'cas_number': drug.get('cas_number', 'N/A'),
                'uni': drug.get('uni', 'N/A'),
                'state': drug.get('state', 'N/A'),
                'groups': drug.get('groups', []),
                'food_interactions': drug.get('food_interactions', []),
                'description': drug.get('description', '')
            }
            return jsonify(molecular_info)

        return jsonify({'error': 'Not found'}), 404

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)